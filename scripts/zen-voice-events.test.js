import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { Events } from "discord.js";
import { watchZenVoice } from "./zen-voice-events.mjs";

function fixture() {
  const client = new EventEmitter();
  const voices = new Map([
    ["zen-student", { id: "zen-student", channelId: "zen-room" }],
    ["normal-student", { id: "normal-student", channelId: "normal-room" }],
    ["disconnected", { id: "disconnected", channelId: null }],
  ]);
  client.guilds = { cache: new Map([["guild", { voiceStates: { cache: voices } }]]) };
  const ready = vi.fn(() => true);
  const queue = { add: vi.fn() };
  const changed = vi.fn();
  watchZenVoice(client, Events, "guild", ready, queue, changed);
  return { client, ready, queue, changed };
}
describe("live Discord voice notifications", () => {
  it.each([Events.ClientReady, Events.ShardResume, Events.GuildAvailable])("recovers connected students after %s, including those outside Zen rooms", event => {
    const { client, queue } = fixture();
    client.emit(event);
    expect(queue.add.mock.calls).toEqual([["zen-student"], ["normal-student"]]);
  });
  it("catches up after a fresh shard connection, after aggregate readiness is updated", async () => {
    const { client, ready, queue } = fixture();
    ready.mockReturnValue(false);
    client.emit(Events.ShardReady);
    ready.mockReturnValue(true);
    await new Promise(resolve => setImmediate(resolve));
    expect(queue.add.mock.calls).toEqual([["zen-student"], ["normal-student"]]);
  });
  it("queues joins, moves, disconnects and server-unmutes, but ignores self-mute changes", () => {
    const { client, queue } = fixture();
    const state = { id: "student", guild: { id: "guild" }, channelId: "zen-room", serverMute: true };
    client.emit(Events.VoiceStateUpdate, { ...state, channelId: null }, state);
    client.emit(Events.VoiceStateUpdate, state, { ...state, channelId: "normal-room" });
    client.emit(Events.VoiceStateUpdate, state, { ...state, channelId: null });
    client.emit(Events.VoiceStateUpdate, state, { ...state, serverMute: false });
    expect(queue.add).toHaveBeenCalledTimes(4);
    client.emit(Events.VoiceStateUpdate, state, { ...state, selfMute: true });
    client.emit(Events.VoiceStateUpdate, state, { ...state, channelId: "other", guild: { id: "other-guild" } });
    expect(queue.add).toHaveBeenCalledTimes(4);
  });
});
