# Reviewing

The queue is meant to be read one card at a time, so it takes the keyboard:
<kbd>j</kbd> and <kbd>k</kbd> move, <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> are
keep / needs editing / reject on the card under the cursor, <kbd>o</kbd> opens
it in JBrowse and <kbd>/</kbd> jumps to the search box. The same digit twice
takes a verdict back off. **Keys** in the toolbar, or <kbd>?</kbd>, shows the
list.

Set **Unreviewed** as the verdict filter and the queue drains as it is judged,
the cursor closing over each card that leaves.

## Saving verdicts

Verdicts live in the reviewer's browser (`localStorage`) — one browser, one
machine. **Export** writes them out as TSV for a pipeline and **Import** reads
that TSV back, so a second reviewer, a second laptop or cleared site data is not
a review started again from nothing.

## What comes out

```
portal/
  index.html      the review page — filters, verdicts, export
  config.json     a JBrowse config naming the data below
  data/           bgzipped and indexed copies of your inputs, plus
                  conflicts.bed — every junction that differs
  img/            one capture per candidate
  jbrowse/        JBrowse itself, with --with-app
```

Nothing points outside the directory, so `aws s3 sync portal/ s3://…` is the
whole deployment.
