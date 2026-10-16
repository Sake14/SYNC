"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { clockPongSchema, healthSchema, readySchema, type ClientToServerEvents, type ServerToClientEvents } from "@sync/shared";

type ConnectionStatus = "checking" | "online" | "offline";
type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

function socketOrigin() {
  if (process.env.NEXT_PUBLIC_SOCKET_URL) return process.env.NEXT_PUBLIC_SOCKET_URL;
  const origin = new URL(window.location.origin);
  origin.port = "4000";
  return origin.origin;
}

export function useConnection() {
  const [http, setHttp] = useState<ConnectionStatus>("checking");
  const [socketStatus, setSocketStatus] = useState<ConnectionStatus>("checking");
  const [roundTripMs, setRoundTripMs] = useState<number | null>(null);
  const socketRef = useRef<ClientSocket | null>(null);
  const requestId = useRef(0);
  const invalidateRequests = useCallback(() => { requestId.current++; }, []);

  const checkHttp = useCallback(async () => {
    const id = ++requestId.current;
    setHttp("checking");
    try {
      const response = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("Unavailable");
      healthSchema.parse(await response.json());
      if (id === requestId.current) setHttp("online");
    } catch {
      if (id === requestId.current) setHttp("offline");
    }
  }, []);

  const ping = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    const startedAt = performance.now();
    socket.timeout(4000).emit("clock:ping", { clientSentAtMs: Date.now() }, (error, result) => {
      if (socketRef.current !== socket || !socket.connected) return;
      if (error || !result?.ok || !clockPongSchema.safeParse(result.data).success) {
        setSocketStatus("offline");
        setRoundTripMs(null);
        return;
      }
      setSocketStatus("online");
      setRoundTripMs(Math.round(performance.now() - startedAt));
    });
  }, []);

  useEffect(() => {
    const socket: ClientSocket = io(socketOrigin(), { autoConnect: false, timeout: 4000 });
    socketRef.current = socket;
    socket.on("server:ready", (payload) => {
      if (!readySchema.safeParse(payload).success) {
        setSocketStatus("offline");
        return;
      }
      ping();
    });
    const offline = () => { setSocketStatus("offline"); setRoundTripMs(null); };
    socket.on("disconnect", offline);
    socket.on("connect_error", offline);
    socket.connect();
    const initial = window.setTimeout(() => { void checkHttp(); }, 0);
    const interval = window.setInterval(() => { void checkHttp(); ping(); }, 15_000);
    return () => {
      invalidateRequests();
      window.clearTimeout(initial);
      window.clearInterval(interval);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [checkHttp, ping, invalidateRequests]);

  const refresh = () => {
    void checkHttp();
    if (socketRef.current?.connected) ping();
    else {
      setSocketStatus("checking");
      socketRef.current?.connect();
    }
  };
  return { http, socketStatus, roundTripMs, refresh };
}
