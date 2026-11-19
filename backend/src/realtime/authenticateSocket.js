// Socket.io connection middleware: the client sends its credential in the handshake,
//   io(url, { auth: { token } })  — Clerk session or demo token
//   io(url, { auth: { invite } }) — candidate invite secret
// and the socket carries the resulting principal in `socket.data.principal`.
// Checked once, at connection: an open socket stays authorised until it disconnects.
export const createSocketAuthenticator = (resolver) => async (socket, next) => {
  const { token, invite } = socket.handshake.auth ?? {};
  try {
    const principal = await resolver.fromCredentials({
      bearer: typeof token === "string" && token ? token : undefined,
      invite: typeof invite === "string" && invite ? invite : undefined,
    });
    if (!principal) return next(new Error("Unauthorized"));
    socket.data.principal = principal;
    return next();
  } catch (err) {
    console.error("Socket auth error:", err.message);
    return next(new Error("Unauthorized"));
  }
};
