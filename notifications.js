(() => {
  const button = document.getElementById('notification-button');
  const badge = document.getElementById('notification-count');
  const panel = document.getElementById('notification-panel');
  const container = document.getElementById('notification-list');
  const markAllButton = document.getElementById('notification-mark-all');

  if (!button || !badge || !panel || !container) return;

  async function loadNotifications() {
    try {
      const response = await fetch('/api/notifications');

      if (!response.ok) {
        throw new Error('Unable to load notifications.');
      }

      const data = await response.json();

      badge.textContent = data.unreadCount || '';
      badge.hidden = !data.unreadCount;

      container.replaceChildren();

      if (!data.notifications.length) {
        container.textContent = 'You have no notifications.';
        return;
      }

      data.notifications.forEach(notification => {
        const card = document.createElement('div');
        card.className = 'notification-card';

        const title = document.createElement('strong');
        title.textContent = notification.title;

        const message = document.createElement('p');
        message.textContent = notification.message;

        const date = document.createElement('small');
        date.textContent = new Date(
          notification.createdAt
        ).toLocaleString();

        card.append(title, message, date);

        if (!notification.isRead) {
          const readButton = document.createElement('button');
          readButton.type = 'button';
          readButton.textContent = 'Mark as read';

          readButton.addEventListener('click', async () => {
            const result = await fetch(
              `/api/notifications/${encodeURIComponent(notification.id)}/read`,
              { method: 'PATCH' }
            );

            if (result.ok) {
              loadNotifications();
            }
          });

          card.appendChild(readButton);
        }

        container.appendChild(card);
      });
    } catch (error) {
      container.textContent = error.message;
    }
  }

  window.loadStreetSenseNotifications = loadNotifications;

  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;

    if (!panel.hidden) {
      loadNotifications();
    }
  });

  if (markAllButton) {
    markAllButton.addEventListener('click', async () => {
      const response = await fetch('/api/notifications/read-all', {
        method: 'PATCH'
      });

      if (response.ok) {
        loadNotifications();
      }
    });
  }

  // Load the unread count if the citizen is already signed in.
  if (!button.classList.contains('hidden')) {
    loadNotifications();
  }
})();