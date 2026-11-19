import { describe, expect, it } from 'vitest';
import { findRoomCode } from '../roomCode';
import { extractRoomCode, inviteLink, inviteText, lenientRoomCode, readInviteCode, videoOfInvite, withoutInvite } from './invite';

const ROOM = 'amber-lofi-k7q2x9dm';
const VID = 'dQw4w9WgXcQ';

describe('invite links', () => {
  it('builds a watch link that carries the code, and falls back to the home page', () => {
    expect(inviteLink(ROOM, VID)).toBe(`https://www.youtube.com/watch?v=${VID}&pact=${ROOM}`);
    expect(inviteLink(ROOM, null)).toBe(`https://www.youtube.com/?pact=${ROOM}`);
  });

  it('invite text keeps the "room code:" line pact’s chat recognises, plus the link', () => {
    const text = inviteText(ROOM, VID);
    expect(findRoomCode(text)).toBe(ROOM);
    expect(text).toContain(inviteLink(ROOM, VID));
  });

  it('reads the code from the query or the fragment, only on youtube.com', () => {
    expect(readInviteCode(`https://www.youtube.com/watch?v=${VID}&pact=${ROOM}`)).toBe(ROOM);
    expect(readInviteCode(`https://www.youtube.com/watch?v=${VID}#pact=${ROOM}`)).toBe(ROOM);
    expect(readInviteCode(`https://m.youtube.com/watch?pact=${ROOM}&v=${VID}`)).toBe(ROOM);
    expect(readInviteCode(`https://www.youtube.com/watch?v=${VID}&pact=Amber%20Lofi`)).toBe('amber-lofi'); // normalised like a typed code
    for (const no of [
      `https://evil.example/watch?v=${VID}&pact=${ROOM}`,
      `https://www.youtube.com.evil.example/watch?pact=${ROOM}`,
      `https://www.youtube.com/watch?v=${VID}`,
      `https://www.youtube.com/watch?v=${VID}&pact=`,
      `https://www.youtube.com/watch?v=${VID}&pact=!!`,
      `https://www.youtube.com/watch?v=${VID}&pact=abc`, // too short to be a code
      `javascript:alert(1)//?pact=${ROOM}`,
      'not a url',
    ])
      expect(readInviteCode(no)).toBeNull();
  });

  it('removes the code from an address, leaving everything else alone', () => {
    expect(withoutInvite(`https://www.youtube.com/watch?v=${VID}&pact=${ROOM}&t=30s`)).toBe(`https://www.youtube.com/watch?v=${VID}&t=30s`);
    expect(withoutInvite(`https://www.youtube.com/watch?v=${VID}#pact=${ROOM}`)).toBe(`https://www.youtube.com/watch?v=${VID}`);
    expect(withoutInvite(`https://www.youtube.com/watch?v=${VID}#t=1&pact=${ROOM}`)).toBe(`https://www.youtube.com/watch?v=${VID}#t=1`);
    expect(withoutInvite(`https://www.youtube.com/watch?v=${VID}`)).toBe(`https://www.youtube.com/watch?v=${VID}`);
    expect(withoutInvite('nonsense')).toBe('nonsense');
  });
});

describe('finding a code in what someone pasted', () => {
  it('handles a bare code, an invite link, the invite text and a link inside prose', () => {
    expect(extractRoomCode(ROOM)).toBe(ROOM);
    expect(extractRoomCode(`  ${ROOM.toUpperCase()}  `)).toBe(ROOM);
    expect(extractRoomCode(inviteLink(ROOM, VID))).toBe(ROOM);
    expect(extractRoomCode(inviteText(ROOM, VID))).toBe(ROOM);
    expect(extractRoomCode(`hey come watch (${inviteLink(ROOM, VID)}) with us!`)).toBe(ROOM);
    expect(extractRoomCode(`🍿 Join my VibeParty — room code: ${ROOM}`)).toBe(ROOM);
  });

  it('returns null rather than inventing a code out of ordinary text', () => {
    for (const no of [
      '',
      '   ',
      'hello there my friend',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://example.com/?pact=amber-lofi-k7q2x9dm',
      'ab',
      '!!!',
    ])
      expect(extractRoomCode(no)).toBeNull();
  });

  it('finds the video a pasted link is about', () => {
    expect(videoOfInvite(inviteLink(ROOM, VID))).toBe(VID);
    expect(videoOfInvite(ROOM)).toBeNull();
  });
});

describe('typed or pasted into a code field', () => {
  it('accepts what extractRoomCode does, plus loosely typed codes', () => {
    expect(lenientRoomCode(inviteLink(ROOM, VID))).toBe(ROOM);
    expect(lenientRoomCode('  Friday Vibes ')).toBe('friday-vibes');
    expect(lenientRoomCode('FRIDAY_vibes!!')).toBe('fridayvibes');
  });

  it('refuses an address without a code and anything too short, instead of inventing a room', () => {
    for (const no of ['', 'ab', '!', `https://www.youtube.com/watch?v=${VID}`, 'youtube.com/watch', 'me@example.com']) expect(lenientRoomCode(no)).toBeNull();
  });
});
