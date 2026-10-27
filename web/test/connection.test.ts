import assert from "node:assert/strict";
import { test } from "node:test";
import { Connection, getBackoffDelay, NOT_CONNECTED_MESSAGE, type ConnectionEnvironment } from "../src/connection.ts";
import type { ConnectionStatus } from "../src/protocol.ts";

class FakeSocket {
  readyState: number = WebSocket.CONNECTING;
  onopen: () => void = () => {};
  onclose: () => void = () => {};
  onmessage: (event: { data: string }) => void = () => {};
  sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
  open(): void {
    this.readyState = WebSocket.OPEN;
    this.onopen();
  }
  drop(): void {
    this.readyState = WebSocket.CLOSED;
    this.onclose();
  }
}

function setup(isLoginValid = true) {
  const sockets: FakeSocket[] = [];
  const delays: number[] = [];
  const statuses: ConnectionStatus[] = [];
  const reloads: number[] = [];
  let opens = 0;
  const environment: ConnectionEnvironment = {
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    isLoginValid: async () => isLoginValid,
    reload: () => reloads.push(1),
    schedule: (callback, delay) => {
      delays.push(delay);
      callback();
    },
  };
  const connection = new Connection(
    {
      onStatus: (status) => statuses.push(status),
      onOpen: () => {
        opens++;
      },
      onMessage: () => {},
    },
    environment,
  );
  return { connection, sockets, delays, statuses, reloads, getOpens: () => opens };
}

test("backs off from 500 ms to a 10 s cap", () => {
  assert.deepEqual([0, 1, 2, 5, 9].map(getBackoffDelay), [500, 1000, 2000, 10_000, 10_000]);
});

test("reconnects after a drop and resets the backoff once open", async () => {
  const { connection, sockets, delays, statuses, getOpens } = setup();
  connection.connect();
  sockets[0].open();
  sockets[0].drop();
  await new Promise((resolve) => setImmediate(resolve));
  sockets[1].drop();
  await new Promise((resolve) => setImmediate(resolve));
  sockets[2].open();
  assert.deepEqual(delays, [500, 1000]);
  assert.equal(sockets.length, 3);
  assert.equal(getOpens(), 2);
  assert.equal(statuses.at(-1), "connected");
  assert.throws(() => setup().connection.send({}), { message: NOT_CONNECTED_MESSAGE });
});

test("reloads the page when the login has expired", async () => {
  const { connection, sockets, reloads, delays } = setup(false);
  connection.connect();
  sockets[0].drop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reloads.length, 1);
  assert.equal(delays.length, 0);
});
