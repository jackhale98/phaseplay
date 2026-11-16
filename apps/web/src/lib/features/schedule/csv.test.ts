import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv, parseTable } from './csv';

describe('parseCsv', () => {
  it('parses plain rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });
  it('handles quoted fields with commas, quotes and newlines', () => {
    expect(parseCsv('name,notes\n"Smith, Jo","Said ""hi""\nthen left"')).toEqual([
      ['name', 'notes'],
      ['Smith, Jo', 'Said "hi"\nthen left'],
    ]);
  });
  it('handles CRLF, CR and a trailing newline', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a,b\r1,2\r')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
  it('strips a UTF-8 BOM', () => {
    expect(parseCsv('﻿Date,Time\n1/2/2026,7pm')[0]).toEqual(['Date', 'Time']);
  });
  it('keeps empty fields and drops blank lines', () => {
    expect(parseCsv('a,,c\n\n,,\n1,,3')).toEqual([
      ['a', '', 'c'],
      ['1', '', '3'],
    ]);
  });
  it('detects semicolon and tab delimiters', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(detectDelimiter('"x;y",b,c')).toBe(',');
    expect(parseCsv('a;b\n"1;5";2')).toEqual([
      ['a', 'b'],
      ['1;5', '2'],
    ]);
  });
});

describe('parseTable', () => {
  it('uses the first row as trimmed headers and pads short rows', () => {
    expect(parseTable(' Date , Name \n2026-01-01')).toEqual({
      headers: ['Date', 'Name'],
      rows: [['2026-01-01', '']],
    });
  });
});
