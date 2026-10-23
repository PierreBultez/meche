//! A local HTTP server answering a script of canned responses, one per request, for the
//! tests of the sync (no real server, no network). Tests only.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::thread::JoinHandle;

/// A request the server received.
#[derive(Debug, Clone)]
pub struct Received {
    /// e.g. `POST /api/sync`.
    pub line: String,
    pub headers: String,
    pub body: String,
}

impl Received {
    /// The body as JSON.
    pub fn json(&self) -> serde_json::Value {
        serde_json::from_str(&self.body).unwrap()
    }
}

/// Starts the server. Each `(status, body)` answers one request, in order; the handle gives
/// back the requests received once they are all answered.
pub fn serve(script: Vec<(&'static str, String)>) -> (String, JoinHandle<Vec<Received>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let handle = std::thread::spawn(move || {
        let mut received = Vec::new();
        for (status, body) in script {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream);
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let mut headers = String::new();
            let mut length = 0;
            loop {
                let mut header = String::new();
                reader.read_line(&mut header).unwrap();
                if header == "\r\n" {
                    break;
                }
                if let Some(value) = header.to_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap();
                }
                headers.push_str(&header);
            }
            let mut request_body = vec![0; length];
            reader.read_exact(&mut request_body).unwrap();
            let answer = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            reader.get_mut().write_all(answer.as_bytes()).unwrap();
            received.push(Received {
                line: line.trim_end().to_string(),
                headers,
                body: String::from_utf8(request_body).unwrap(),
            });
        }
        received
    });
    (base, handle)
}
