use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

// ── Stream ──────────────────────────────────────────────────

pub struct TransportStream {
    #[cfg(unix)]
    inner: tokio::net::UnixStream,
    #[cfg(windows)]
    inner: TransportStreamInner,
}

#[cfg(windows)]
enum TransportStreamInner {
    Server(tokio::net::windows::named_pipe::NamedPipeServer),
    Client(tokio::net::windows::named_pipe::NamedPipeClient),
}

impl TransportStream {
    #[cfg(unix)]
    pub(crate) fn from_unix(stream: tokio::net::UnixStream) -> Self {
        Self { inner: stream }
    }

    #[cfg(windows)]
    pub(crate) fn from_server(pipe: tokio::net::windows::named_pipe::NamedPipeServer) -> Self {
        Self {
            inner: TransportStreamInner::Server(pipe),
        }
    }

    #[cfg(windows)]
    pub(crate) fn from_client(pipe: tokio::net::windows::named_pipe::NamedPipeClient) -> Self {
        Self {
            inner: TransportStreamInner::Client(pipe),
        }
    }

    pub fn into_split(self) -> (ReadHalf, WriteHalf) {
        #[cfg(unix)]
        {
            let (r, w) = self.inner.into_split();
            (ReadHalf::Unix(r), WriteHalf::Unix(w))
        }
        #[cfg(windows)]
        {
            let (r, w) = tokio::io::split(self);
            (ReadHalf::Windows(r), WriteHalf::Windows(w))
        }
    }
}

impl AsyncRead for TransportStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        #[cfg(unix)]
        {
            Pin::new(&mut self.get_mut().inner).poll_read(cx, buf)
        }
        #[cfg(windows)]
        {
            match &mut self.get_mut().inner {
                TransportStreamInner::Server(s) => Pin::new(s).poll_read(cx, buf),
                TransportStreamInner::Client(s) => Pin::new(s).poll_read(cx, buf),
            }
        }
    }
}

impl AsyncWrite for TransportStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        #[cfg(unix)]
        {
            Pin::new(&mut self.get_mut().inner).poll_write(cx, buf)
        }
        #[cfg(windows)]
        {
            match &mut self.get_mut().inner {
                TransportStreamInner::Server(s) => Pin::new(s).poll_write(cx, buf),
                TransportStreamInner::Client(s) => Pin::new(s).poll_write(cx, buf),
            }
        }
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        #[cfg(unix)]
        {
            Pin::new(&mut self.get_mut().inner).poll_flush(cx)
        }
        #[cfg(windows)]
        {
            match &mut self.get_mut().inner {
                TransportStreamInner::Server(s) => Pin::new(s).poll_flush(cx),
                TransportStreamInner::Client(s) => Pin::new(s).poll_flush(cx),
            }
        }
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        #[cfg(unix)]
        {
            Pin::new(&mut self.get_mut().inner).poll_shutdown(cx)
        }
        #[cfg(windows)]
        {
            match &mut self.get_mut().inner {
                TransportStreamInner::Server(s) => Pin::new(s).poll_shutdown(cx),
                TransportStreamInner::Client(s) => Pin::new(s).poll_shutdown(cx),
            }
        }
    }
}

// ── Split halves ────────────────────────────────────────────

pub enum ReadHalf {
    #[cfg(unix)]
    Unix(tokio::net::unix::OwnedReadHalf),
    #[cfg(windows)]
    Windows(tokio::io::ReadHalf<TransportStream>),
}

pub enum WriteHalf {
    #[cfg(unix)]
    Unix(tokio::net::unix::OwnedWriteHalf),
    #[cfg(windows)]
    Windows(tokio::io::WriteHalf<TransportStream>),
}

impl AsyncRead for ReadHalf {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        match self.get_mut() {
            #[cfg(unix)]
            ReadHalf::Unix(s) => Pin::new(s).poll_read(cx, buf),
            #[cfg(windows)]
            ReadHalf::Windows(s) => Pin::new(s).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for WriteHalf {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        match self.get_mut() {
            #[cfg(unix)]
            WriteHalf::Unix(s) => Pin::new(s).poll_write(cx, buf),
            #[cfg(windows)]
            WriteHalf::Windows(s) => Pin::new(s).poll_write(cx, buf),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            #[cfg(unix)]
            WriteHalf::Unix(s) => Pin::new(s).poll_flush(cx),
            #[cfg(windows)]
            WriteHalf::Windows(s) => Pin::new(s).poll_flush(cx),
        }
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            #[cfg(unix)]
            WriteHalf::Unix(s) => Pin::new(s).poll_shutdown(cx),
            #[cfg(windows)]
            WriteHalf::Windows(s) => Pin::new(s).poll_shutdown(cx),
        }
    }
}

// ── Listener ────────────────────────────────────────────────

pub struct TransportListener {
    #[cfg(unix)]
    inner: tokio::net::UnixListener,
    #[cfg(windows)]
    pipe_name: String,
    #[cfg(windows)]
    next_server: tokio::sync::Mutex<tokio::net::windows::named_pipe::NamedPipeServer>,
}

impl TransportListener {
    /// Bind a listener to the given path.
    /// On unix, `path` is a filesystem socket path.
    /// On Windows, `path` is a named pipe path (e.g. `\\.\pipe\emergent-user`).
    pub fn bind(path: &std::path::Path) -> io::Result<Self> {
        #[cfg(unix)]
        {
            let listener = tokio::net::UnixListener::bind(path)?;
            Ok(Self { inner: listener })
        }
        #[cfg(windows)]
        {
            let pipe_name = path.to_string_lossy().into_owned();
            let server = tokio::net::windows::named_pipe::ServerOptions::new()
                .first_pipe_instance(true)
                .create(&pipe_name)?;
            Ok(Self {
                pipe_name,
                next_server: tokio::sync::Mutex::new(server),
            })
        }
    }

    /// Accept the next client connection.
    pub async fn accept(&self) -> io::Result<TransportStream> {
        #[cfg(unix)]
        {
            let (stream, _addr) = self.inner.accept().await?;
            Ok(TransportStream::from_unix(stream))
        }
        #[cfg(windows)]
        {
            let mut guard = self.next_server.lock().await;
            guard.connect().await?;
            let connected = std::mem::replace(
                &mut *guard,
                tokio::net::windows::named_pipe::ServerOptions::new()
                    .first_pipe_instance(false)
                    .create(&self.pipe_name)?,
            );
            drop(guard);
            Ok(TransportStream::from_server(connected))
        }
    }
}

// ── Client connect ──────────────────────────────────────────

/// Connect to a daemon at the given path.
pub async fn connect(path: &std::path::Path) -> io::Result<TransportStream> {
    #[cfg(unix)]
    {
        let stream = tokio::net::UnixStream::connect(path).await?;
        Ok(TransportStream::from_unix(stream))
    }
    #[cfg(windows)]
    {
        let pipe_name = path.to_string_lossy();
        let client = tokio::net::windows::named_pipe::ClientOptions::new().open(&*pipe_name)?;
        Ok(TransportStream::from_client(client))
    }
}
