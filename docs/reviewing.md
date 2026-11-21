# Reviewing

Each card asks **What should happen to this model?**, with its answers as
buttons under the picture, each showing its key. **Clear** takes the answer
back.

| Key                                    | Does                                                  |
| -------------------------------------- | ----------------------------------------------------- |
| <kbd>j</kbd> <kbd>k</kbd>              | next, previous card                                   |
| <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> | keep, needs editing, reject the card under the cursor |
| <kbd>0</kbd>                           | clear its answer                                      |
| <kbd>o</kbd>                           | open the card in JBrowse                              |
| <kbd>/</kbd>                           | search                                                |
| <kbd>?</kbd>                           | show these keys                                       |

With the verdict filter on **Unreviewed**, each card leaves the queue once
answered, and the cursor moves to the next.

The queue holds at most `--max` models a class, 12 by default, the ones with the
most exons. When that leaves flagged models out, the header says how many.

## Asking your own question

`--question question.json` replaces the question and its answers:

```json
{
  "question": "Is the model right?",
  "answers": [
    { "label": "Right", "key": "r", "tone": "real" },
    { "label": "Wrong", "key": "w", "tone": "artifact" }
  ]
}
```

| Field   | Is                                                                         | Unless given           |
| ------- | -------------------------------------------------------------------------- | ---------------------- |
| `label` | the button's text; required                                                |                        |
| `value` | what the browser stores and **Export** writes in the `verdict` column      | the label              |
| `key`   | one character; the build refuses a key the page uses, such as <kbd>j</kbd> | its place, 1 up        |
| `tone`  | the pressed button's color: `real`, `unsure`, `artifact` or `accent`       | the card's class color |
| `title` | the button's tooltip                                                       |                        |

The page drops a stored answer that no button offers. To rename a label and keep
the answers already given, give the old label as its `value`.
[variant-review-portal](https://github.com/cmdcolin/variant-review-portal) reads
the same file.

## Saving answers

Answers live in the reviewer's browser until **Export** writes them as TSV.
**Import** reads that TSV back, for a second reviewer or a second machine. The
button counts the answers given since the last export or import, as
`Export · 3 new`.

## What comes out

```
portal/
  index.html      the review page
  config.json     a JBrowse config naming the data below
  data/           bgzipped and indexed copies of your inputs, plus
                  conflicts.bed, every junction that differs
  img/            one capture per candidate
  jbrowse/        JBrowse itself, with --with-app
```

Nothing points outside the directory, so `aws s3 sync portal/ s3://…` deploys it
whole.
