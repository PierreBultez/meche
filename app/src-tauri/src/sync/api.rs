//! The HTTP client of the Mèche API (docs/04).
//!
//! One `Api` is created at startup and shared: `reqwest::Client` keeps its connections open
//! (keep-alive), so a sync every minute does not pay for a new TLS handshake each time.
//! Cloning it is cheap: the clones share the same connection pool (an `Arc` inside).
//!
//! The client itself is built at its first use, not at startup: building it loads the system's
//! certificates, and when that fails (no certificate found) the notes must still open, offline.

use std::sync::{Arc, OnceLock};
use std::time::Duration;

use reqwest::{RequestBuilder, Response, StatusCode};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::json;

use super::protocol::{
    Device, Devices, Health, Invitation, Invitations, SyncRequest, SyncResponse, TokenResponse,
};
use crate::error::{Error, Result};

/// Version of the sync protocol this app speaks (`api` in `GET /api/health`).
const API_VERSION: i64 = 1;

/// The server may ask to wait this long at most (`Retry-After`): a larger value is not trusted.
const MAX_RETRY_AFTER_SECS: u64 = 3600;

#[derive(Clone, Default)]
pub struct Api {
    /// Built once, at the first request. `OnceLock`: a value set only once, safely shared
    /// between threads; `Arc` shares it between the clones of `Api`. The `Err` keeps why it
    /// could not be built, reported by every request.
    http: Arc<OnceLock<std::result::Result<reqwest::Client, String>>>,
}

impl Api {
    pub fn new() -> Api {
        Api::default()
    }

    /// The HTTP client, built at the first call.
    fn http(&self) -> Result<&reqwest::Client> {
        self.http
            .get_or_init(build_client)
            .as_ref()
            .map_err(|error| Error::Network(error.clone()))
    }

    /// `GET /api/health`: is there a Mèche server at this address?
    pub async fn health(&self, base: &str) -> Result<Health> {
        let health: Health = send(self.http()?.get(format!("{base}/api/health"))).await?;
        if !health.ok || health.api != API_VERSION {
            return Err(not_meche(format!("api version {}", health.api)));
        }
        Ok(health)
    }

    /// `POST /api/auth/token`.
    pub async fn login(
        &self,
        base: &str,
        email: &str,
        password: &str,
        device_name: &str,
    ) -> Result<TokenResponse> {
        let body = json!({ "email": email, "password": password, "device_name": device_name });
        send(
            self.http()?
                .post(format!("{base}/api/auth/token"))
                .json(&body),
        )
        .await
    }

    /// `POST /api/auth/register`: creates an account with an invitation code.
    pub async fn register(
        &self,
        base: &str,
        invitation_code: &str,
        email: &str,
        password: &str,
        device_name: &str,
    ) -> Result<TokenResponse> {
        let body = json!({
            "invitation_code": invitation_code,
            "email": email,
            "password": password,
            "device_name": device_name,
        });
        send(
            self.http()?
                .post(format!("{base}/api/auth/register"))
                .json(&body),
        )
        .await
    }

    /// `DELETE /api/auth/token`: this device's token stops working.
    pub async fn logout(&self, base: &str, token: &str) -> Result<()> {
        send_empty(
            self.http()?
                .delete(format!("{base}/api/auth/token"))
                .bearer_auth(token),
        )
        .await
    }

    /// `POST /api/sync`: push and pull in one round trip.
    pub async fn sync(
        &self,
        base: &str,
        token: &str,
        request: &SyncRequest<'_>,
    ) -> Result<SyncResponse> {
        send(
            self.http()?
                .post(format!("{base}/api/sync"))
                .bearer_auth(token)
                .json(request),
        )
        .await
    }

    pub async fn devices(&self, base: &str, token: &str) -> Result<Vec<Device>> {
        let devices: Devices = send(
            self.http()?
                .get(format!("{base}/api/devices"))
                .bearer_auth(token),
        )
        .await?;
        Ok(devices.devices)
    }

    pub async fn revoke_device(&self, base: &str, token: &str, id: i64) -> Result<()> {
        send_empty(
            self.http()?
                .delete(format!("{base}/api/devices/{id}"))
                .bearer_auth(token),
        )
        .await
    }

    pub async fn invitations(&self, base: &str, token: &str) -> Result<Vec<Invitation>> {
        let invitations: Invitations = send(
            self.http()?
                .get(format!("{base}/api/invitations"))
                .bearer_auth(token),
        )
        .await?;
        Ok(invitations.invitations)
    }

    pub async fn create_invitation(&self, base: &str, token: &str) -> Result<Invitation> {
        send(
            self.http()?
                .post(format!("{base}/api/invitations"))
                .bearer_auth(token)
                .json(&EmptyBody {}),
        )
        .await
    }

    pub async fn delete_invitation(&self, base: &str, token: &str, id: i64) -> Result<()> {
        send_empty(
            self.http()?
                .delete(format!("{base}/api/invitations/{id}"))
                .bearer_auth(token),
        )
        .await
    }
}

#[derive(Serialize)]
struct EmptyBody {}

fn build_client() -> std::result::Result<reqwest::Client, String> {
    // reqwest is built with "rustls-no-provider": rustls needs to be told which cryptography
    // to use, once per process. A second call fails harmlessly (tests).
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .user_agent(concat!("Meche/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        // Per read, not for the whole request: a 4 MB sync on a slow mobile connection may
        // take minutes, as long as data keeps coming.
        .read_timeout(Duration::from_secs(30))
        // The API never redirects. Following one could send a password or notes elsewhere,
        // even over plain http (reqwest sends the body again on a 307 / 308).
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("cannot start the HTTP client: {error}"))
}

fn not_meche(message: String) -> Error {
    Error::Api {
        status: 0,
        code: "not_meche_server".to_string(),
        message,
        retry_after: None,
    }
}

/// Sends a request and reads its JSON answer.
///
/// `async fn`: calling it gives a "future", a computation that runs when it is `.await`ed.
/// While it waits for the network, the thread is free to run other tasks (Tauri's tokio
/// runtime): nothing is blocked. `T: DeserializeOwned` is the type the JSON is read into.
async fn send<T: DeserializeOwned>(request: RequestBuilder) -> Result<T> {
    let response = checked(request).await?;
    // Read, then decoded: a connection lost while reading is a network error; only an answer
    // that is not the JSON expected says it is not a Mèche server.
    let body = response
        .bytes()
        .await
        .map_err(|error| Error::Network(error.to_string()))?;
    serde_json::from_slice(&body).map_err(|error| not_meche(format!("unexpected answer: {error}")))
}

/// Sends a request whose answer has no body (204).
async fn send_empty(request: RequestBuilder) -> Result<()> {
    checked(request).await.map(|_| ())
}

/// Sends a request; an answer that is not a success becomes an `Error`.
async fn checked(request: RequestBuilder) -> Result<Response> {
    let response = request
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|error| Error::Network(error.to_string()))?;
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let retry_after = response
        .headers()
        .get("Retry-After")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .map(|seconds| seconds.clamp(1, MAX_RETRY_AFTER_SECS));
    let body: serde_json::Value = response.json().await.unwrap_or_default();
    Err(api_error(status, &body, retry_after))
}

/// The error for an answer with this status and JSON body (`{ "error": "…", "message": "…" }`
/// from the Mèche API, docs/04).
fn api_error(status: StatusCode, body: &serde_json::Value, retry_after: Option<u64>) -> Error {
    let message = body["message"].as_str().unwrap_or_default().to_string();
    let code = match (status, body["error"].as_str()) {
        // A wrong password says so; any other 401 is a token the server no longer knows.
        (_, Some("invalid_credentials")) => "invalid_credentials",
        (StatusCode::UNAUTHORIZED, _) => "unauthorized",
        (StatusCode::TOO_MANY_REQUESTS, _) => "rate_limited",
        (_, Some(code)) if status.is_client_error() => code,
        // A page that is not from the Mèche API (Apache, another site, a proxy), or a redirect
        // (the API never redirects).
        (StatusCode::NOT_FOUND | StatusCode::METHOD_NOT_ALLOWED, None) => "not_meche_server",
        _ if status.is_redirection() => "not_meche_server",
        _ => "server",
    };
    Error::Api {
        status: status.as_u16(),
        code: code.to_string(),
        message,
        retry_after,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;

    /// A one-request HTTP server on a free local port, answering `status` with `body`.
    /// Returns its address and a handle that gives the request it received.
    fn fake_server(
        status: &str,
        headers: &str,
        body: &str,
    ) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let answer = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{headers}Connection: close\r\n\r\n{body}",
            body.len()
        );
        let handle = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream);
            let mut request = String::new();
            let mut length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if let Some(value) = line.to_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap();
                }
                request.push_str(&line);
                if line == "\r\n" {
                    break;
                }
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            request.push_str(&String::from_utf8(body).unwrap());
            reader.get_mut().write_all(answer.as_bytes()).unwrap();
            request
        });
        (address, handle)
    }

    /// Runs a future to its end, for tests (the app runs them on Tauri's runtime).
    fn run<F: std::future::Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    #[test]
    fn logs_in_with_the_device_name_and_reads_the_token() {
        let (base, server) = fake_server(
            "200 OK",
            "",
            r#"{"token":"1|meche_abc","email":"p@example.com","sync_id":"s1"}"#,
        );
        let api = Api::new();
        let answer = run(api.login(&base, "p@example.com", "secret", "PC")).unwrap();
        assert_eq!(answer.token, "1|meche_abc");
        let request = server.join().unwrap();
        assert!(request.starts_with("POST /api/auth/token HTTP/1.1"));
        assert!(request.contains(r#""device_name":"PC""#));
    }

    #[test]
    fn sends_the_token_with_the_sync() {
        let (base, server) = fake_server(
            "200 OK",
            "",
            r#"{"applied":[],"conflicts":[],"changes":[],"cursor":0,"has_more":false,"server_time":5,"sync_id":"s"}"#,
        );
        let api = Api::new();
        let request = SyncRequest {
            cursor: 0,
            sync_id: Some("s"),
            changes: &[],
        };
        let answer = run(api.sync(&base, "1|meche_abc", &request)).unwrap();
        assert_eq!(answer.server_time, 5);
        assert!(!answer.reset);
        let received = server.join().unwrap().to_lowercase();
        assert!(received.contains("authorization: bearer 1|meche_abc"));
        assert!(received.contains(r#"{"cursor":0,"sync_id":"s","changes":[]}"#));
    }

    #[test]
    fn tells_apart_a_wrong_password_a_revoked_token_and_a_refusal() {
        let cases = [
            (
                "401 Unauthorized",
                r#"{"error":"invalid_credentials"}"#,
                "invalid_credentials",
            ),
            (
                "401 Unauthorized",
                r#"{"message":"Unauthenticated."}"#,
                "unauthorized",
            ),
            (
                "422 Unprocessable Entity",
                r#"{"error":"email_taken","message":"x"}"#,
                "email_taken",
            ),
            ("500 Internal Server Error", "<html>oops</html>", "server"),
            ("404 Not Found", "<html>not here</html>", "not_meche_server"),
        ];
        for (status, body, kind) in cases {
            let (base, server) = fake_server(status, "", body);
            let error = run(Api::new().login(&base, "a", "b", "c")).unwrap_err();
            assert_eq!(error.kind(), kind, "{status} {body}");
            server.join().unwrap();
        }
    }

    #[test]
    fn reads_how_long_to_wait_after_too_many_requests() {
        let (base, server) = fake_server("429 Too Many Requests", "Retry-After: 42\r\n", "{}");
        let error = run(Api::new().login(&base, "a", "b", "c")).unwrap_err();
        assert!(matches!(
            error,
            Error::Api { ref code, retry_after: Some(42), .. } if code == "rate_limited"
        ));
        server.join().unwrap();
    }

    #[test]
    fn never_waits_more_than_an_hour_whatever_the_server_says() {
        let (base, server) = fake_server(
            "429 Too Many Requests",
            "Retry-After: 18446744073709551615\r\n",
            "{}",
        );
        let error = run(Api::new().login(&base, "a", "b", "c")).unwrap_err();
        assert!(matches!(
            error,
            Error::Api {
                retry_after: Some(3600),
                ..
            }
        ));
        server.join().unwrap();
    }

    #[test]
    fn does_not_follow_redirects() {
        let (base, server) = fake_server(
            "308 Permanent Redirect",
            "Location: http://example.com/api/auth/token\r\n",
            "",
        );
        let error = run(Api::new().login(&base, "a", "secret", "c")).unwrap_err();
        assert_eq!(error.kind(), "not_meche_server");
        server.join().unwrap();
    }

    #[test]
    fn a_connection_cut_while_reading_is_a_network_error() {
        // Announces 100 bytes, sends 2, then closes the connection.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let _ = stream.read(&mut request).unwrap();
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{\"")
                .unwrap();
        });
        let error = run(Api::new().health(&base)).unwrap_err();
        assert_eq!(error.kind(), "network");
        server.join().unwrap();
    }

    #[test]
    fn an_unreachable_server_is_a_network_error() {
        // Nothing listens on this port any more.
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let error = run(Api::new().health(&format!("http://127.0.0.1:{port}"))).unwrap_err();
        assert_eq!(error.kind(), "network");
    }

    #[test]
    fn refuses_a_server_that_is_not_a_meche_server() {
        let (base, server) = fake_server("200 OK", "", r#"{"hello":"world"}"#);
        let error = run(Api::new().health(&base)).unwrap_err();
        assert_eq!(error.kind(), "not_meche_server");
        server.join().unwrap();
    }
}
