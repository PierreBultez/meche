//! The HTTP client of the Mèche API (docs/04).
//!
//! One `Api` is created at startup and shared: `reqwest::Client` keeps its connections open
//! (keep-alive), so a sync every minute does not pay for a new TLS handshake each time.
//! Cloning it is cheap: the clones share the same connection pool (an `Arc` inside).
//!
//! The client itself is built at its first use, not at startup: building it loads the system's
//! certificates, and when that fails (no certificate found) the notes must still open, offline.
//!
//! Time limits: 30 s to get the answer's headers (connecting, sending, the server's work), plus
//! time for a large request on a slow connection; then the answer is read piece by piece, and
//! only 30 s without receiving anything stops it. A total limit would make a 4 MB sync fail
//! forever on a slow mobile connection.

use std::sync::{Arc, OnceLock};
use std::time::Duration;

use reqwest::header::CONTENT_TYPE;
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

/// Time to get the answer's headers for a small request.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(30);
/// Upload speed assumed for a large request (about 256 kbit/s): a 4 MB sync gets two more
/// minutes to be sent.
const SLOW_UPLOAD_BYTES_PER_SEC: u64 = 32 * 1024;
/// While the answer is read: at most this long without receiving anything.
const READ_TIMEOUT: Duration = Duration::from_secs(30);
/// The largest answer read (a sync sends 4 MB of notes at most, plus conflicts): a broken
/// server or a proxy cannot fill the memory.
const MAX_ANSWER_BYTES: usize = 64 * 1024 * 1024;
/// An error page is read quickly or not at all: the status already says what went wrong.
const MAX_ERROR_BYTES: usize = 64 * 1024;
const ERROR_BODY_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Default)]
pub struct Api {
    /// Built at the first request that succeeds in building it. `OnceLock`: a value set only
    /// once, safely shared between threads; `Arc` shares it between the clones of `Api`.
    http: Arc<OnceLock<reqwest::Client>>,
}

impl Api {
    pub fn new() -> Api {
        Api::default()
    }

    /// The HTTP client, built at the first call. A failure is not kept: the next request tries
    /// again (certificates installed meanwhile).
    fn http(&self) -> Result<&reqwest::Client> {
        if let Some(client) = self.http.get() {
            return Ok(client);
        }
        let client = build_client().map_err(Error::Network)?;
        // Two requests may build one at the same time: the first one stored is kept.
        Ok(self.http.get_or_init(|| client))
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
        // Turned into JSON here to know its size: a large batch gets more time to be sent.
        let body = serde_json::to_vec(request)?;
        let until_answer = answer_timeout(body.len());
        send_within(
            self.http()?
                .post(format!("{base}/api/sync"))
                .bearer_auth(token)
                .header(CONTENT_TYPE, "application/json")
                .body(body),
            until_answer,
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
        // No other limit here (see the top of this file): reqwest's `read_timeout` would also
        // limit the whole sending of a request, not each piece of it.
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

/// Time to get the answer's headers for a request of `request_bytes`.
fn answer_timeout(request_bytes: usize) -> Duration {
    ANSWER_TIMEOUT + Duration::from_secs(request_bytes as u64 / SLOW_UPLOAD_BYTES_PER_SEC)
}

/// Sends a small request and reads its JSON answer.
///
/// `async fn`: calling it gives a "future", a computation that runs when it is `.await`ed.
/// While it waits for the network, the thread is free to run other tasks (Tauri's tokio
/// runtime): nothing is blocked. `T: DeserializeOwned` is the type the JSON is read into.
async fn send<T: DeserializeOwned>(request: RequestBuilder) -> Result<T> {
    send_within(request, ANSWER_TIMEOUT).await
}

/// Sends a request, waits `until_answer` at most for the answer's headers, reads its JSON.
async fn send_within<T: DeserializeOwned>(
    request: RequestBuilder,
    until_answer: Duration,
) -> Result<T> {
    let response = checked(request, until_answer).await?;
    // Read, then decoded: a connection lost while reading is a network error; only an answer
    // that is not the JSON expected says it is not a Mèche server.
    let body = read_body(response, MAX_ANSWER_BYTES).await?;
    serde_json::from_slice(&body).map_err(|error| not_meche(format!("unexpected answer: {error}")))
}

/// Sends a request whose answer has no body (204).
async fn send_empty(request: RequestBuilder) -> Result<()> {
    checked(request, ANSWER_TIMEOUT).await.map(|_| ())
}

/// Sends a request; an answer that is not a success becomes an `Error`.
async fn checked(request: RequestBuilder, until_answer: Duration) -> Result<Response> {
    // `tokio::time::timeout` gives up on a future after this long (`Err(Elapsed)`); the request
    // is then dropped, which closes its connection. `send()` ends when the headers arrive.
    let sent = tokio::time::timeout(
        until_answer,
        request.header("Accept", "application/json").send(),
    )
    .await;
    let response = match sent {
        Ok(Ok(response)) => response,
        Ok(Err(error)) => return Err(Error::Network(error.to_string())),
        Err(_elapsed) => {
            return Err(Error::Network(format!(
                "no answer within {} s",
                until_answer.as_secs()
            )));
        }
    };
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
    let read = tokio::time::timeout(ERROR_BODY_TIMEOUT, read_body(response, MAX_ERROR_BYTES));
    let body: serde_json::Value = match read.await {
        Ok(Ok(bytes)) => serde_json::from_slice(&bytes).unwrap_or_default(),
        // Too long, too large or cut: the error is told by its status alone.
        _ => serde_json::Value::Null,
    };
    Err(api_error(status, &body, retry_after))
}

/// Reads the answer piece by piece: it stops only when nothing arrives for `READ_TIMEOUT`, or
/// when it is larger than `max_bytes`. `mut response`: reading pieces moves through the
/// answer, which changes it.
async fn read_body(mut response: Response, max_bytes: usize) -> Result<Vec<u8>> {
    let mut body = Vec::new();
    loop {
        match tokio::time::timeout(READ_TIMEOUT, response.chunk()).await {
            Ok(Ok(Some(piece))) => {
                if body.len() + piece.len() > max_bytes {
                    return Err(Error::Network(format!(
                        "the answer is larger than {} KB",
                        max_bytes / 1024
                    )));
                }
                body.extend_from_slice(&piece);
            }
            // The whole answer was read.
            Ok(Ok(None)) => return Ok(body),
            Ok(Err(error)) => return Err(Error::Network(error.to_string())),
            Err(_elapsed) => {
                return Err(Error::Network(format!(
                    "the answer stopped coming for {} s",
                    READ_TIMEOUT.as_secs()
                )));
            }
        }
    }
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
        // A page that is not from the Mèche API (the web server, another site, a proxy), or a redirect
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
    fn a_large_request_gets_more_time_to_be_sent() {
        assert_eq!(answer_timeout(0), Duration::from_secs(30));
        // A 4 MB batch: two more minutes, enough at about 256 kbit/s.
        assert_eq!(
            answer_timeout(4 * 1024 * 1024),
            Duration::from_secs(30 + 128)
        );
    }

    #[test]
    fn an_answer_that_keeps_coming_slowly_is_read_whole() {
        // The answer arrives in pieces, 0.4 s apart: no total limit stops it.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let _ = stream.read(&mut request).unwrap();
            let body = br#"{"ok":true,"api":1,"server_time":7}"#;
            stream
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
                        body.len()
                    )
                    .as_bytes(),
                )
                .unwrap();
            for piece in body.chunks(10) {
                std::thread::sleep(Duration::from_millis(400));
                stream.write_all(piece).unwrap();
                stream.flush().unwrap();
            }
        });
        let health = run(Api::new().health(&base)).unwrap();
        assert_eq!(health.server_time, 7);
        server.join().unwrap();
    }

    #[test]
    fn a_large_error_page_is_told_by_its_status() {
        let page = "<html>".repeat(20_000);
        let (base, server) = fake_server("500 Internal Server Error", "", &page);
        let error = run(Api::new().login(&base, "a", "b", "c")).unwrap_err();
        assert_eq!(error.kind(), "server");
        // The connection may be dropped before the whole page was sent: that is fine.
        let _ = server.join();
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
