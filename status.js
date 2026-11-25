
'use strict';

/* Shows the signed-in person's reports inside the "Know where yours stands" section. */

(() => {
  const box = document.getElementById('status-list');
  if (!box) return;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function signInPrompt() {
    const d = el('div', 'status-empty');
    d.append(el('p', null, 'Sign in to see the status of every report you have filed.'));

    const b = el('button', 'btn btn-primary', 'Sign in');
    b.type = 'button';

    b.addEventListener('click', () => {
      const t = document.getElementById('open-login');
      if (t) t.click();
    });

    d.append(b);
    return d;
  }

  async function render(user, items) {
    const frag = document.createDocumentFragment();
    const admin = user.role === 'admin';

    frag.append(
      el(
        'p',
        'status-note',
        admin
          ? `Signed in as administrator: showing all ${items.length} reports. Review and update them in the admin console.`
          : `${items.length} report${items.length === 1 ? '' : 's'} filed by ${user.displayName}.`
      )
    );

    if (admin) {
      const a = el('a', 'status-link', 'Open admin console');
      a.href = '/admin.html';
      frag.lastChild.append(' ', a);
    }

    if (!items.length) {
      const d = el('div', 'status-empty');
      d.append(
        el('p', null, 'No reports yet. Use "Report an issue" at the top to file your first one.')
      );
      frag.append(d);
    }

    const grid = el('div', 'status-grid');

    const sortedItems = items.slice().sort((a, b) =>
      String(b.createdAt).localeCompare(String(a.createdAt))
    );

    for (const x of sortedItems) {
      // Create complaint card and header
      const row = el('article', 'status-card');
      const headerRow = el('div', 'mine-top');

      headerRow.append(
        el('span', 'plate', x.id),
        el(
          'span',
          'st st-' + String(x.status).toLowerCase().replace(/\s+/g, '-'),
          x.status
        )
      );

      row.append(
        headerRow,
        el('strong', null, x.category),
        el(
          'small',
          null,
          `${x.location || 'Location not given'} · ${new Date(x.createdAt).toLocaleDateString()}`
        )
      );

      if (x.adminNote) {
        row.append(el('p', 'mine-note', 'Reviewer note: ' + x.adminNote));
      }

      // Load repair progress timeline
      const timelineBox = el('div', 'repair-timeline');
      timelineBox.append(
        el('strong', null, 'Repair Progress Timeline')
      );

      try {
        const timelineResponse = await fetch(
          '/api/complaints/' + encodeURIComponent(x.id) + '/updates',
          {
            credentials: 'same-origin',
            cache: 'no-store'
          }
        );

        if (timelineResponse.ok) {
          const timelineData = await timelineResponse.json();
          const updates = timelineData.updates || [];

          if (updates.length) {
            const list = el('ol', 'repair-timeline-list');

            updates.forEach(update => {
              const entry = el('li', 'repair-timeline-entry');

              entry.append(
                el('strong', null, update.status)
              );

              if (update.note) {
                entry.append(
                  el('p', null, update.note)
                );
              }

              entry.append(
                el(
                  'small',
                  null,
                  new Date(update.createdAt).toLocaleString()
                )
              );

              list.append(entry);
            });

            timelineBox.append(list);
          } else {
            timelineBox.append(
              el('p', null, 'No repair progress updates yet.')
            );
          }
        } else {
          timelineBox.append(
            el('p', null, 'Repair history is currently unavailable.')
          );
        }
      } catch (error) {
        console.error('Repair timeline loading error:', error);

        timelineBox.append(
          el('p', null, 'Could not load repair history.')
        );
      }

      row.append(timelineBox);
            // Load before/after repair verification evidence.
      const verificationBox = el('div', 'repair-verification');
      verificationBox.append(
        el('strong', null, 'Repair Verification Evidence')
      );

      try {
        const verificationResponse = await fetch(
          '/api/complaints/' + encodeURIComponent(x.id) + '/verifications',
          {
            credentials: 'same-origin',
            cache: 'no-store'
          }
        );

        if (verificationResponse.ok) {
          const verificationData = await verificationResponse.json();
          const records = verificationData.items || [];

          if (records.length) {
            records.forEach(record => {
              const card = el('div', 'verification-evidence-card');

              const title = record.kind === 'before_repair'
                ? 'Before Repair'
                : 'After Repair';

              card.append(
                el('strong', null, title),
                el(
                  'span',
                  'verification-status verification-' +
                    String(record.status).toLowerCase(),
                  record.status
                )
              );

              if (record.note) {
                card.append(el('p', null, record.note));
              }

              const photo = el('img', 'verification-evidence-image');
              photo.src = record.imageUrl;
              photo.alt = title + ' evidence';
              photo.loading = 'lazy';
              card.append(photo);

              if (record.reviewNote) {
                card.append(
                  el('p', 'verification-review-note',
                    'Review note: ' + record.reviewNote)
                );
              }

              if (record.reviewedAt) {
                card.append(
                  el('small', null,
                    'Reviewed: ' +
                    new Date(record.reviewedAt).toLocaleString())
                );
              }

              verificationBox.append(card);
            });
          } else {
            verificationBox.append(
              el('p', null, 'No repair verification photos submitted yet.')
            );
          }
        } else {
          verificationBox.append(
            el('p', null, 'Repair verification is currently unavailable.')
          );
        }
      } catch (error) {
        console.error('Repair verification loading error:', error);
        verificationBox.append(
          el('p', null, 'Could not load repair verification evidence.')
        );
      }

      row.append(verificationBox);

      // Delete complaint option
      if (
        admin ||
        ['Submitted', 'Under review', 'Rejected'].includes(x.status)
      ) {
        const del = el('button', 'btn btn-danger btn-sm', 'Delete');
        del.type = 'button';

        del.addEventListener('click', async () => {
          if (
            !window.confirm(
              'Delete report ' +
              x.id +
              (x.image ? ' and its photo' : '') +
              ' permanently? This cannot be undone.'
            )
          ) {
            return;
          }

          try {
            const r = await fetch(
              '/api/complaints/' + encodeURIComponent(x.id),
              {
                method: 'DELETE',
                credentials: 'same-origin'
              }
            );

            const d = await r.json().catch(() => ({}));

            if (
              r.status === 404 &&
              /route not found/i.test(d.error || '')
            ) {
              window.alert(
                'The running server is older than these pages. Check that the latest server.js is installed and restart StreetSense.'
              );
              return;
            }

            if (!r.ok) {
              window.alert(d.error || 'Could not delete this report.');
              return;
            }

            await load();
          } catch (error) {
            window.alert('Could not delete this report: ' + error.message);
          }
        });

        row.append(del);
      } else {
        row.append(
          el(
            'small',
            null,
            'Being handled by the team. Ask an administrator if it must be removed.'
          )
        );
      }

      grid.append(row);
    }

    frag.append(grid);
    box.replaceChildren(frag);
  }

  async function load() {
    try {
      const meResponse = await fetch('/api/auth/me', {
        credentials: 'same-origin',
        cache: 'no-store'
      });

      const me = await meResponse.json();

      if (!me.user) {
        box.replaceChildren(signInPrompt());
        return;
      }

      const r = await fetch('/api/complaints', {
        credentials: 'same-origin',
        cache: 'no-store'
      });

      const d = await r.json();

      if (!r.ok) {
        throw new Error(d.error || 'Could not load reports');
      }

      await render(me.user, d.items || []);

    } catch (e) {
      console.error('Complaint loading error:', e);

      box.replaceChildren(
        el('p', 'status-empty', 'Could not load your reports: ' + e.message)
      );
    }
  }

  load();

  setInterval(load, 15000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      load();
    }
  });

  const form = document.getElementById('report-form');

  if (form) {
    form.addEventListener('submit', () => {
      setTimeout(load, 1500);
      setTimeout(load, 5000);
    });
  }

  const chip = document.getElementById('profile-chip');

  if (chip) {
    new MutationObserver(load).observe(chip, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });
  }
})();
