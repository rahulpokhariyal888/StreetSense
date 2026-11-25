
(() => {
  'use strict';

  const $ = id => document.getElementById(id);

  const form = $('verification-upload-form');
  const workOrderSelect = $('verification-work-order');
  const kindSelect = $('verification-kind');
  const photoInput = $('verification-photo');
  const noteInput = $('verification-note');
  const message = $('verification-upload-message');
  const list = $('verification-list');
  const refreshButton = $('refresh-verifications');

  if (!form || !workOrderSelect || !photoInput || !list) {
    console.error('Repair verification HTML elements are missing.');
    return;
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Request failed.');
    }

    return data;
  }

  function showMessage(text, isError = false) {
    if (!message) return;
    message.textContent = text;
    message.style.color = isError ? '#c0392b' : '';
  }

  function addText(parent, tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = text || '';
    if (className) element.className = className;
    parent.appendChild(element);
    return element;
  }

  async function loadWorkOrders() {
    try {
      const data = await api('/api/work-orders');

      workOrderSelect.replaceChildren();

      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Select a work order';
      workOrderSelect.appendChild(placeholder);

      (data.items || []).forEach(order => {
        const option = document.createElement('option');
        option.value = order.id;
        option.textContent =
          `${order.id} — ${order.title || order.incident || 'Repair work order'} (${order.status || 'Unknown'})`;
        workOrderSelect.appendChild(option);
      });

      if (!data.items || !data.items.length) {
        placeholder.textContent = 'No work orders available';
      }
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  function createVerificationCard(item) {
    const card = document.createElement('article');
    card.className = 'verification-card';

    const heading = document.createElement('h3');
    heading.textContent = `${item.workOrderId} — ${
      item.kind === 'before_repair' ? 'Before repair' : 'After repair'
    }`;
    card.appendChild(heading);

    addText(card, 'p', `Status: ${item.status || 'Pending'}`);
    addText(card, 'p', `Note: ${item.note || 'No note provided.'}`);

    if (item.workOrder) {
      addText(
        card,
        'p',
        `Incident: ${item.workOrder.incident || 'Not available'}`
      );
      addText(
        card,
        'p',
        `Work order status: ${item.workOrder.status || 'Unknown'}`
      );
    }

    addText(
      card,
      'small',
      `Uploaded: ${item.createdAt ? new Date(item.createdAt).toLocaleString() : 'Unknown'}`
    );

    if (item.imageUrl) {
      const image = document.createElement('img');
      image.src = item.imageUrl;
      image.alt = `${item.kind} repair verification photo`;
      image.loading = 'lazy';
      image.style.maxWidth = '100%';
      image.style.maxHeight = '280px';
      image.style.objectFit = 'contain';
      image.style.display = 'block';
      image.style.margin = '12px 0';
      card.appendChild(image);
    }

    if (item.status === 'Pending') {
      const controls = document.createElement('div');
      controls.className = 'verification-review-actions';

      const approveButton = document.createElement('button');
      approveButton.type = 'button';
      approveButton.textContent = 'Approve';
      approveButton.addEventListener('click', () => review(item.id, 'Approved'));

      const rejectButton = document.createElement('button');
      rejectButton.type = 'button';
      rejectButton.textContent = 'Reject';
      rejectButton.addEventListener('click', () => review(item.id, 'Rejected'));

      controls.append(approveButton, rejectButton);
      card.appendChild(controls);
    }

    if (item.status === 'Rejected' && item.reviewNote) {
      addText(card, 'p', `Rejection reason: ${item.reviewNote}`);
    }

    if (item.status === 'Approved' && item.reviewNote) {
      addText(card, 'p', `Review note: ${item.reviewNote}`);
    }

    return card;
  }

  async function loadVerifications() {
    list.textContent = 'Loading verification submissions...';

    try {
      const data = await api('/api/verifications');
      list.replaceChildren();

      const items = data.items || [];

      if (!items.length) {
        list.textContent = 'No repair verification submissions yet.';
        return;
      }

      items.forEach(item => {
        list.appendChild(createVerificationCard(item));
      });
    } catch (error) {
      list.textContent = error.message;
    }
  }

  async function review(id, status) {
    let reviewNote = '';

    if (status === 'Rejected') {
      reviewNote = window.prompt('Enter the reason for rejecting this verification:');

      if (reviewNote === null) return;

      reviewNote = reviewNote.trim();

      if (!reviewNote) {
        window.alert('A rejection reason is required.');
        return;
      }
    }

    try {
      await api(`/api/verifications/${encodeURIComponent(id)}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ status, reviewNote })
      });

      await loadVerifications();
      showMessage(`Verification ${status.toLowerCase()} successfully.`);
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');

        if (comma < 0) {
          reject(new Error('Could not read the selected image.'));
          return;
        }

        resolve(result.slice(comma + 1));
      };

      reader.onerror = () => reject(new Error('Could not read the selected image.'));
      reader.readAsDataURL(file);
    });
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    showMessage('');

    const workOrderId = workOrderSelect.value;
    const kind = kindSelect.value;
    const file = photoInput.files && photoInput.files[0];
    const note = noteInput ? noteInput.value.trim() : '';

    if (!workOrderId) {
      showMessage('Please select a work order.', true);
      return;
    }

    if (!['before_repair', 'after_repair'].includes(kind)) {
      showMessage('Please select a valid photo type.', true);
      return;
    }

    if (!file) {
      showMessage('Please select a photo.', true);
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      showMessage('The image must be 8 MB or smaller.', true);
      return;
    }

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      showMessage('Only JPEG, PNG, and WebP images are supported.', true);
      return;
    }

    const submitButton = $('verification-upload-submit');
    if (submitButton) submitButton.disabled = true;

    try {
      const base64 = await readFileAsBase64(file);

      await api('/api/verifications', {
        method: 'POST',
        body: JSON.stringify({
          workOrderId,
          kind,
          filename: file.name,
          mimeType: file.type,
          base64,
          note
        })
      });

      form.reset();
      showMessage('Photo uploaded. It is now awaiting administrator review.');
      await loadVerifications();
      await loadWorkOrders();
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });

  if (refreshButton) {
    refreshButton.addEventListener('click', loadVerifications);
  }

  window.loadStreetSenseVerifications = async () => {
    await Promise.all([loadWorkOrders(), loadVerifications()]);
  };

})();
