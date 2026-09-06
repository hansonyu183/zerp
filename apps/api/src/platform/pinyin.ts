import { pinyin } from 'pinyin-pro'

/** Canonical search spelling for names used in search. */
export function searchPinyin(name: string): string {
  return pinyin(name, {
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive',
  })
    .join('')
    .replace(/\s+/gu, '')
    .toLowerCase()
}
