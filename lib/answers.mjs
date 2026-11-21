export const QUESTION = 'What should happen to this model?'

export const VERDICTS = [
  { v: 'keep', label: 'Keep', key: '1', tone: 'real' },
  { v: 'edit', label: 'Needs editing', key: '2', tone: 'unsure' },
  { v: 'reject', label: 'Reject', key: '3', tone: 'artifact' },
]

export const CLEAR_KEY = '0'

export const PAGE_KEYS = {
  j: 'next card',
  k: 'previous card',
  o: 'open in JBrowse',
  '/': 'search',
  '?': 'keys',
  [CLEAR_KEY]: 'clear the answer',
}

const TONES = ['real', 'unsure', 'artifact', 'accent']

/** { "question": "...", "answers": [{ "label", "value"?, "key"?, "tone"?, "title"? }] } */
export function readQuestion(text) {
  const { question, answers } = JSON.parse(text)
  if (typeof question !== 'string' || !question.trim()) {
    throw new Error('needs a "question": the text each card asks')
  }
  if (!Array.isArray(answers) || !answers.length) {
    throw new Error('needs "answers": a list of { "label" } entries')
  }
  const choices = answers.map((a, i) => {
    const label = `${a.label ?? ''}`.trim()
    const v = `${a.value ?? label}`.trim()
    const key = `${a.key ?? (i < 9 ? i + 1 : '')}`
    if (!label) {
      throw new Error(`answer ${i + 1} has no "label"`)
    }
    if (v === 'unreviewed') {
      throw new Error('"unreviewed" is what the TSV writes for no answer')
    }
    if (key.length !== 1) {
      throw new Error(`"${label}" needs a "key" of one character`)
    }
    if (Object.hasOwn(PAGE_KEYS, key)) {
      throw new Error(
        `"${label}" is keyed ${key}, which the page binds to ${PAGE_KEYS[key]}`,
      )
    }
    if (a.tone !== undefined && !TONES.includes(a.tone)) {
      throw new Error(
        `"${label}" has tone "${a.tone}": give one of ${TONES.join(', ')}`,
      )
    }
    return { v, label, key, tone: a.tone, title: a.title }
  })
  for (const field of ['v', 'key']) {
    const seen = choices.map(c => c[field])
    const twice = seen.find((x, i) => seen.indexOf(x) !== i)
    if (twice !== undefined) {
      throw new Error(
        `two answers share the ${field === 'v' ? 'value' : 'key'} "${twice}"`,
      )
    }
  }
  return { question: question.trim(), choices }
}
