import { describe, it, expect } from 'vitest';
import { parseCsv, addressesFrom } from '../../bin/syncCampaignsUnsubscribes';

describe('parseCsv', () => {
  it('reads a plain export', () => {
    expect(parseCsv('email,name\na@example.com,Alice\n')).toEqual([
      ['email', 'name'],
      ['a@example.com', 'Alice'],
    ]);
  });

  /**
   * The reason this is not `split(',')`. A display name containing a comma is
   * ordinary, and splitting naively shifts every later column — which in the
   * bounce mode means suppressing whatever lands in the email position.
   */
  it('keeps a quoted comma inside its field', () => {
    expect(parseCsv('email,name\na@example.com,"Smith, Alice"\n')).toEqual([
      ['email', 'name'],
      ['a@example.com', 'Smith, Alice'],
    ]);
  });

  it('unescapes a doubled quote', () => {
    expect(parseCsv('name\n"She said ""hi"""\n')).toEqual([['name'], ['She said "hi"']]);
  });

  it('survives a newline inside a quoted field', () => {
    expect(parseCsv('email,note\na@example.com,"line one\nline two"\n')).toEqual([
      ['email', 'note'],
      ['a@example.com', 'line one\nline two'],
    ]);
  });

  it('handles CRLF, which is what a downloaded export usually has', () => {
    expect(parseCsv('email\r\na@example.com\r\n')).toEqual([['email'], ['a@example.com']]);
  });

  it('drops blank lines rather than emitting empty rows', () => {
    expect(parseCsv('email\n\na@example.com\n\n')).toEqual([['email'], ['a@example.com']]);
  });
});

describe('addressesFrom', () => {
  it('finds the column by header, not by position', () => {
    const rows = parseCsv('First Name,Contact Email,Status\nAlice,a@example.com,Unsubscribed\n');
    expect(addressesFrom(rows)).toEqual(['a@example.com']);
  });

  /**
   * Zoho's exports disagree with each other on column order, so a fixed index
   * would quietly read names as addresses on whichever export it was not
   * written against.
   */
  it('finds it in a different position in a different export', () => {
    const rows = parseCsv('Email Address,Reason\nb@example.com,Hard bounce\n');
    expect(addressesFrom(rows)).toEqual(['b@example.com']);
  });

  it('reads a headerless one-column list without eating the first address', () => {
    expect(addressesFrom(parseCsv('a@example.com\nb@example.com\n'))).toEqual(['a@example.com', 'b@example.com']);
  });

  it('returns nothing when no column holds an address', () => {
    expect(addressesFrom(parseCsv('name,status\nAlice,Unsubscribed\n'))).toEqual([]);
  });

  it('returns nothing for an empty file', () => {
    expect(addressesFrom(parseCsv(''))).toEqual([]);
  });
});
