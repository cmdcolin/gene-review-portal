// The review page. One component tree, rendered twice: to a string when the
// portal is written, so the cards and their captures are in the HTML before any
// script runs, and again in the browser to hydrate the parts that take input.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { CLEAR_KEY, QUESTION, VERDICTS } from './answers.mjs'

const num = n => Math.abs(n).toLocaleString()

// What the class alone cannot say: which junction, and by how much. A splice
// site 12 bp out and an intron cut through the middle of a reference exon are
// the same class and completely different edits.
function phrase(c) {
  const at = `intron ${c.index}`
  if (c.kind === 'donor') {
    return `${at} donor off by ${num(c.shift)} bp`
  }
  if (c.kind === 'acceptor') {
    return `${at} acceptor off by ${num(c.shift)} bp`
  }
  if (c.kind === 'skips') {
    return `${at} skips ${c.skipped} reference exon${c.skipped > 1 ? 's' : ''}`
  }
  if (c.kind === 'in-exon') {
    return `${at} falls inside a reference exon`
  }
  if (c.kind === 'shifted') {
    return `${at} shifted ${num(c.shift)} bp`
  }
  // Both ends are splice sites the reference uses, so nothing moved — the model
  // pairs them into an isoform the reference does not carry.
  if (c.kind === 'pairing') {
    return `${at} pairs two reference splice sites no isoform pairs`
  }
  return `${at} matches no reference intron`
}

export function storageKey(portalId) {
  return `gene-review:${portalId}`
}

export function matches(card, { cls, verdictFilter, q, verdicts }) {
  if (cls !== 'all' && card.cls !== cls) {
    return false
  }
  const v = verdicts[card.id] ?? ''
  if (verdictFilter === 'unreviewed' && v) {
    return false
  }
  if (
    verdictFilter !== 'all' &&
    verdictFilter !== 'unreviewed' &&
    v !== verdictFilter
  ) {
    return false
  }
  if (q) {
    const hay =
      `${card.id} ${(card.genes ?? []).join(' ')} ${card.loc}`.toLowerCase()
    if (!hay.includes(q.trim().toLowerCase())) {
      return false
    }
  }
  return true
}

// Only the models this build carries. A rerun with a smaller --max keeps the
// portalId, so the earlier verdicts are still in storage, and counting them
// reads as "16 of 12 judged" over a bar past its own end — while dropping them
// would throw away a review the next wider rerun could still use.
export function tallyVerdicts(cards, verdicts, choices) {
  const c = Object.fromEntries(choices.map(b => [b.v, 0]))
  for (const card of cards) {
    const v = verdicts[card.id]
    if (Object.hasOwn(c, v)) {
      c[v]++
    }
  }
  return c
}

/**
 * The models whose verdict differs from the last export, or from what an
 * import brought in: the work that lives only in this browser.
 */
export function unexported(cards, verdicts, exported) {
  return cards.filter(({ id }) => verdicts[id] !== exported[id]).length
}

/** `changes` over `prev`, a null taking the entry off */
export function mergeEdits(prev, changes) {
  const next = { ...prev }
  for (const [id, value] of Object.entries(changes)) {
    if (value) {
      next[id] = value
    } else {
      delete next[id]
    }
  }
  return next
}

export function toTsv(cards, verdicts) {
  const apollo = cards.some(c => c.apollo)
  // an annotator picking the queue up in Apollo wants the link, not the locus
  const head = [
    'model_id',
    'class',
    'locus',
    'exons',
    'strand',
    'reference_genes',
    'verdict',
  ]
  if (apollo) {
    head.push('apollo_url')
  }
  const lines = [head.join('\t')]
  for (const c of cards) {
    const row = [
      c.id,
      c.cls,
      c.loc,
      c.nExons,
      c.strand,
      (c.genes ?? []).join(';'),
      verdicts[c.id] ?? 'unreviewed',
    ]
    if (apollo) {
      row.push(c.apollo ?? '')
    }
    lines.push(row.join('\t'))
  }
  return `${lines.join('\n')}\n`
}

// The other half of Export: verdicts live in one browser's localStorage, so
// without this a cleared site setting, a second reviewer or a second machine
// starts the queue from nothing.
export function fromTsv(text, cards, choices) {
  const rows = text.split(/\r?\n/).filter(l => l.trim())
  const head = (rows.shift() ?? '').split('\t')
  const idAt = head.indexOf('model_id')
  const vAt = head.indexOf('verdict')
  if (idAt === -1 || vAt === -1) {
    return { error: 'That file has no model_id and verdict columns.' }
  }
  const known = new Set(cards.map(c => c.id))
  const allowed = new Set(choices.map(b => b.v))
  const changes = {}
  let applied = 0
  let unknown = 0
  for (const line of rows) {
    const f = line.split('\t')
    const id = f[idAt]
    const v = f[vAt]
    if (!id) {
      continue
    }
    if (v === 'unreviewed' || v === '') {
      changes[id] = null
    } else if (allowed.has(v)) {
      changes[id] = v
    } else {
      continue
    }
    if (known.has(id)) {
      applied++
    } else {
      unknown++
    }
  }
  return { changes, applied, unknown }
}

const Detail = React.memo(function Detail({ conflicts }) {
  if (!conflicts?.length) {
    return null
  }
  const shown = conflicts.slice(0, 4).map(phrase)
  if (conflicts.length > shown.length) {
    shown.push(`${conflicts.length - shown.length} more`)
  }
  const { of } = conflicts[0]
  return (
    <div className="detail">
      <b>
        {conflicts.length} of {of} junction{of === 1 ? '' : 's'} disagree
        {conflicts.length === 1 ? 's' : ''}
      </b>
      {' — '}
      <span className="j">{shown.join('; ')}</span>
    </div>
  )
})

const Card = React.memo(function Card({
  card,
  meta,
  question,
  choices,
  verdict,
  current,
  onVerdict,
  onPick,
  bind,
}) {
  const genes = card.genes?.length
    ? card.genes.join(' + ')
    : 'no reference gene here'
  return (
    <article
      className="card"
      ref={el => bind(card.id, el)}
      data-id={card.id}
      data-cls={card.cls}
      data-verdict={verdict}
      data-current={current ? 'true' : undefined}
      onClick={e => {
        if (!e.target.closest('a') && !e.target.closest('.verdicts button')) {
          onPick(card.id)
        }
      }}
    >
      <div className="card-head">
        <span className="chip">{meta.label}</span>
        <span className="model">{card.id}</span>
        <span className="genes">{genes}</span>
        <span className="meta">
          {card.loc} · {card.nExons} exons · {card.spanKb} kb ·{' '}
          {card.strand === '-' ? 'minus' : 'plus'} strand
          {card.gapBp ? ` · ${card.gapBp.toLocaleString()} bp apart` : ''}
        </span>
      </div>
      <div className="why">{meta.why}</div>
      <Detail conflicts={card.conflicts} />
      {card.img ? (
        <img
          className="shot"
          loading="lazy"
          alt={`Genome view of ${card.id}`}
          src={card.img}
        />
      ) : (
        <div className="missing">
          No capture for this model — the portal was built with --no-capture, or
          this one failed. The link still opens it live.
        </div>
      )}
      <div className="card-foot">
        <div className="verdicts" role="group" aria-labelledby={`q-${card.id}`}>
          <span className="question" id={`q-${card.id}`}>
            {question}
          </span>
          {choices.map(b => (
            <button
              key={b.v}
              type="button"
              data-v={b.v}
              data-tone={b.tone}
              title={b.title}
              aria-pressed={verdict === b.v}
              onClick={() => {
                onPick(card.id)
                onVerdict(card.id, b.v)
              }}
            >
              <kbd>{b.key}</kbd>
              {b.label}
            </button>
          ))}
          <button
            type="button"
            className="unanswer"
            disabled={!verdict}
            title="Take the answer back, leaving the model unreviewed"
            onClick={() => {
              onPick(card.id)
              onVerdict(card.id, '')
            }}
          >
            <kbd>{CLEAR_KEY}</kbd>
            Clear
          </button>
        </div>
        <span className="next">
          Annotator action: <b>{meta.action}</b>
        </span>
        <div className="links">
          <a className="live" href={card.url} target="_blank" rel="noopener">
            Open in JBrowse
          </a>
          {card.apollo ? (
            <a
              className="live apollo"
              href={card.apollo}
              target="_blank"
              rel="noopener"
            >
              Edit in Apollo
            </a>
          ) : null}
        </div>
      </div>
    </article>
  )
})

export function App({ data }) {
  const choices = data.verdicts ?? VERDICTS
  const question = data.question ?? QUESTION
  // Verdicts start empty on both sides of hydration and arrive from
  // localStorage on mount — the server has no way to know them, and rendering
  // a guess is a mismatch.
  const [ready, setReady] = useState(false)
  const [verdicts, setVerdicts] = useState({})
  const [exported, setExported] = useState({})
  const [keysOpen, setKeysOpen] = useState(false)
  const [cls, setCls] = useState('all')
  const [verdictFilter, setVerdictFilter] = useState('all')
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(/** @type {string | null} */ (null))
  const [msg, setMsg] = useState('')

  const nodes = useRef(new Map())
  const wantScroll = useRef(false)
  const fileInput = useRef(null)
  const searchInput = useRef(null)
  const msgTimer = useRef(undefined)

  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(storageKey(data.portalId)) ?? '{}',
      )
      const offered = new Set(choices.map(b => b.v))
      setVerdicts(
        Object.fromEntries(
          Object.entries(saved.verdicts ?? {}).filter(([, v]) =>
            offered.has(v),
          ),
        ),
      )
      setExported(saved.exported ?? {})
      setKeysOpen(!!saved.keys)
    } catch {
      /* private window, or site data blocked */
    }
    setReady(true)
  }, [data.portalId, choices])

  useEffect(() => {
    if (!ready) {
      return
    }
    try {
      localStorage.setItem(
        storageKey(data.portalId),
        JSON.stringify({ verdicts, exported, keys: keysOpen }),
      )
    } catch {
      /* nothing to do; the page still works for this session */
    }
  }, [ready, data.portalId, verdicts, exported, keysOpen])

  const bind = useCallback((id, el) => {
    if (el) {
      nodes.current.set(id, el)
    } else {
      nodes.current.delete(id)
    }
  }, [])

  const visible = useMemo(
    () =>
      data.cards.filter(c => matches(c, { cls, verdictFilter, q, verdicts })),
    [data.cards, cls, verdictFilter, q, verdicts],
  )
  const counts = useMemo(
    () => tallyVerdicts(data.cards, verdicts, choices),
    [data.cards, verdicts, choices],
  )
  const done = choices.reduce((n, b) => n + counts[b.v], 0)
  const pending = useMemo(
    () => unexported(data.cards, verdicts, exported),
    [data.cards, verdicts, exported],
  )

  useEffect(() => {
    if (!wantScroll.current) {
      return
    }
    wantScroll.current = false
    nodes.current.get(cursor)?.scrollIntoView({
      block: 'center',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    })
  }, [cursor])

  const setVerdict = useCallback(
    (id, val) => {
      const next = { ...verdicts }
      if (val) {
        next[id] = val
      } else {
        delete next[id]
      }

      // Under a verdict filter the card just judged leaves the list. The cursor
      // steps to the one closing over it — not out of the page with the card,
      // and not back to the top of a queue the reviewer is deep into.
      const card = data.cards.find(c => c.id === id)
      if (card && !matches(card, { cls, verdictFilter, q, verdicts: next })) {
        const i = visible.findIndex(c => c.id === id)
        const successor =
          i === -1 ? null : (visible[i + 1] ?? visible[i - 1] ?? null)
        setCursor(successor?.id ?? null)
      }
      setVerdicts(next)
    },
    [verdicts, data.cards, cls, verdictFilter, q, visible],
  )

  const toggleKeys = useCallback(() => {
    setKeysOpen(open => !open)
  }, [])

  const move = useCallback(
    step => {
      if (!visible.length) {
        return
      }
      const i = visible.findIndex(c => c.id === cursor)
      const next =
        i === -1
          ? step > 0
            ? 0
            : visible.length - 1
          : Math.min(visible.length - 1, Math.max(0, i + step))
      wantScroll.current = true
      setCursor(visible[next].id)
    },
    [visible, cursor],
  )

  // A queue of a hundred cards is read one at a time, and every verdict on it
  // was a click on a small button somewhere down the page.
  useEffect(() => {
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return
      }
      const t = e.target
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) {
        if (e.key === 'Escape') {
          t.blur()
        }
        return
      }
      if (e.key === '/') {
        e.preventDefault()
        searchInput.current?.focus()
        searchInput.current?.select()
        return
      }
      if (e.key === '?') {
        toggleKeys()
        return
      }
      if (e.key === 'j') {
        e.preventDefault()
        move(1)
        return
      }
      if (e.key === 'k') {
        e.preventDefault()
        move(-1)
        return
      }
      if (e.key === 'o') {
        const a = nodes.current.get(cursor)?.querySelector('a.live')
        if (a) {
          window.open(a.href, '_blank', 'noopener')
        }
        return
      }
      const answer =
        e.key === CLEAR_KEY ? '' : choices.find(b => b.key === e.key)?.v
      if (answer === undefined) {
        return
      }
      e.preventDefault()
      const id = visible.some(c => c.id === cursor) ? cursor : visible[0]?.id
      if (!id) {
        return
      }
      if (id !== cursor) {
        wantScroll.current = true
        setCursor(id)
      }
      setVerdict(id, answer)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [move, toggleKeys, setVerdict, visible, cursor, choices])

  // Changing a filter can also strand the cursor on a card that is no longer
  // listed; there is no position to hold on to, so it goes to the top.
  useEffect(() => {
    if (cursor === null || visible.some(c => c.id === cursor)) {
      return
    }
    setCursor(visible.length ? visible[0].id : null)
  }, [visible, cursor])

  // One timer rather than one per message: two messages inside five seconds and
  // the first one's timer wipes the second.
  const say = useCallback(text => {
    setMsg(text)
    clearTimeout(msgTimer.current)
    msgTimer.current = setTimeout(() => {
      setMsg('')
    }, 5000)
  }, [])

  function exportTsv() {
    const blob = new Blob([toTsv(data.cards, verdicts)], {
      type: 'text/tab-separated-values',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${data.portalId}-decisions.tsv`
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => {
      URL.revokeObjectURL(a.href)
    }, 1000)
    setExported(verdicts)
  }

  function importTsv(file) {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      const res = fromTsv(
        typeof reader.result === 'string' ? reader.result : '',
        data.cards,
        choices,
      )
      if (res.error) {
        say(res.error)
        return
      }
      setVerdicts(prev => mergeEdits(prev, res.changes))
      setExported(prev => mergeEdits(prev, res.changes))
      say(
        `${res.applied} verdict${res.applied === 1 ? '' : 's'} read in${
          res.unknown
            ? `, ${res.unknown} for models this portal does not carry`
            : ''
        }.`,
      )
    })
    reader.readAsText(file)
  }

  const clsCounts = useMemo(() => {
    const out = {}
    for (const c of data.cards) {
      out[c.cls] = (out[c.cls] ?? 0) + 1
    }
    return out
  }, [data.cards])

  const chips = [{ k: 'all', label: 'All', n: data.cards.length }].concat(
    data.classOrder
      .filter(k => clsCounts[k])
      .map(k => ({ k, label: data.classes[k].label, n: clsCounts[k] })),
  )

  const pct = x => `${data.cards.length ? (x / data.cards.length) * 100 : 0}%`

  return (
    <>
      <header>
        <h1>{data.title}</h1>
        <span className="eyebrow">{data.eyebrow}</span>
        <span className="counts">
          <span>
            <b>{data.total}</b> models
          </span>
          <span>
            <b>{data.agrees}</b> agree
          </span>
          <span>
            <b>{data.flagged}</b> flagged
          </span>
          {data.cards.length < data.flagged ? (
            <span
              id="left-out"
              title="Rebuild with a larger --max to carry every flagged model"
            >
              <b>{data.flagged - data.cards.length}</b> not in this portal
            </span>
          ) : null}
        </span>
        <div className="progress">
          <div className="r">
            <span id="done">
              {done} of {data.cards.length} judged
            </span>

            <span id="tally">
              {choices
                .map(b => `${counts[b.v]} ${b.label.toLowerCase()}`)
                .join(' · ')}
            </span>
          </div>
          <div className="bar">
            {choices.map(b => (
              <span
                key={b.v}
                data-tone={b.tone}
                style={{ width: pct(counts[b.v]) }}
              />
            ))}
          </div>
        </div>
        <div className="actions">
          <button
            id="keysbtn"
            type="button"
            aria-expanded={keysOpen}
            onClick={toggleKeys}
          >
            Keys
          </button>
          <button
            id="import"
            type="button"
            onClick={() => fileInput.current?.click()}
          >
            Import
          </button>
          <input
            type="file"
            id="importfile"
            ref={fileInput}
            accept=".tsv,.txt,text/tab-separated-values"
            hidden
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) {
                importTsv(file)
              }
              e.target.value = ''
            }}
          />
          <button
            id="export"
            type="button"
            data-pending={pending > 0}
            title={
              pending
                ? `${pending} verdict${pending === 1 ? '' : 's'} since the last export live only in this browser`
                : 'Download every verdict as TSV'
            }
            onClick={exportTsv}
          >
            Export{pending ? ` · ${pending} new` : ''}
          </button>
          <button
            id="reset"
            type="button"
            disabled={!done}
            onClick={() => {
              if (!confirm('Clear every verdict on this portal?')) {
                return
              }
              setVerdicts({})
              setExported({})
            }}
          >
            Reset
          </button>
        </div>

        <div className="hrow">
          <div className="filters">
            {chips.map(ch => (
              <button
                key={ch.k}
                type="button"
                data-cls={ch.k}
                aria-pressed={cls === ch.k}
                onClick={() => {
                  setCls(ch.k)
                }}
              >
                {ch.label}
                <span className="count">{ch.n}</span>
              </button>
            ))}
          </div>
          <select
            id="vf"
            aria-label="Filter by verdict"
            value={verdictFilter}
            onChange={e => {
              setVerdictFilter(e.target.value)
            }}
          >
            {[
              ['all', 'Any verdict'],
              ['unreviewed', 'Unreviewed'],
              ...choices.map(b => [b.v, b.label]),
            ].map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <input
            type="search"
            id="q"
            ref={searchInput}
            placeholder="Find a model or gene"
            value={q}
            onChange={e => {
              setQ(e.target.value)
            }}
          />
          <span id="msg" className="msg" role="status">
            {msg}
          </span>
        </div>

        <div className="keys" id="keys" hidden={!keysOpen}>
          <span>
            <kbd>j</kbd>
            <kbd>k</kbd> move between cards
          </span>
          <span>
            {choices.map(b => (
              <React.Fragment key={b.v}>
                <kbd>{b.key}</kbd> {b.label.toLowerCase()}{' '}
              </React.Fragment>
            ))}
            <kbd>{CLEAR_KEY}</kbd> clear
          </span>
          <span>
            <kbd>o</kbd> open in JBrowse
          </span>
          <span>
            <kbd>/</kbd> search
          </span>
          <span>
            <kbd>?</kbd> these keys
          </span>
        </div>
      </header>

      <main>
        {/* lede and footer are prose make-portal composes itself, with counts
            interpolated into it and nothing off the annotation files. */}
        {/* eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml */}
        <p className="lede" dangerouslySetInnerHTML={{ __html: data.lede }} />

        <div className="cards" id="cards">
          {visible.length ? (
            visible.map(c => (
              <Card
                key={c.id}
                card={c}
                meta={data.classes[c.cls]}
                question={question}
                choices={choices}
                verdict={verdicts[c.id] ?? ''}
                current={c.id === cursor}
                onVerdict={setVerdict}
                onPick={setCursor}
                bind={bind}
              />
            ))
          ) : (
            <div className="empty">No models match these filters.</div>
          )}
        </div>

        {/* eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml */}
        <footer dangerouslySetInnerHTML={{ __html: data.footer }} />
      </main>
    </>
  )
}
