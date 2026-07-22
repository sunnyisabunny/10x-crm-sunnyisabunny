/**
 * clients.js — the Clients page.
 *
 * Loading the list, drawing it, adding a client, deleting a client.
 *
 * Loaded after storage.js, ui.js and data.js.
 */

/* The page's working copy of the client list. Every action follows the same
   three steps: change this array, save it, redraw from it. Keeping one variable
   as the single source of truth is what stops the screen and the stored data
   from drifting apart. */
let clients = [];

/*
  What the toolbar is currently asking for. These three are the only thing that
  decides which clients appear — the `clients` array itself is never filtered
  down, so clearing a control always restores the full list.
*/
const view = { status: 'All', search: '', sort: 'newest' };

/* How long the follow-up reminder waits, per the assignment. */
const REMINDER_DELAY_MS = 60000;

/* Cached element references, looked up once instead of on every redraw. */
const listEl = document.getElementById('client-list');
const overlayEl = document.getElementById('add-client-overlay');
const addFormEl = document.getElementById('add-client-form');
const detailEl = document.getElementById('detail-overlay');

/* Which client the detail window is showing, so Add Note knows its target. */
let openClientId = null;

/*
  Which client the form is editing, or null when creating a new one.

  One form serves both jobs. A separate edit form would mean a second copy of
  six fields and five validation rules that could drift out of step with these
  ones, so a single variable decides whether submitting creates or replaces.
*/
let editingClientId = null;

/* ==================================================================
   Drawing the list
   ================================================================== */

/**
 * Build one client card.
 *
 * Everything is created with createElement and filled with textContent, never
 * by assembling an HTML string. Client names and companies come from the API
 * and from what the user types, and textContent makes the browser treat them
 * as text to display rather than markup to run. A client called
 * <img src=x onerror=...> shows up as those literal characters.
 */
function createClientCard(client) {
  const card = document.createElement('article');
  card.className = 'client-card';
  /* The id travels on the element itself, so one listener on the container can
     work out which client was acted on. Storing the whole object on the node
     would let the DOM hold a stale copy after an edit. */
  card.dataset.id = client.id;

  /* --- Avatar ---
     An uploaded photo wins over the one the API supplied, and initials are
     the fallback when there is neither. createAvatar() in ui.js owns that
     rule so the card, the detail window and the profile page cannot end up
     disagreeing about it. */
  const avatar = createAvatar(client.avatar || client.image, client.name);

  /* --- Name, company, email --- */
  const body = document.createElement('div');
  body.className = 'stack-2';

  const name = document.createElement('div');
  name.className = 'client-card__name';
  name.textContent = client.name;

  const company = document.createElement('div');
  company.className = 'client-card__meta';
  company.textContent = client.company || '—';

  const email = document.createElement('div');
  email.className = 'client-card__meta';
  email.textContent = client.email;

  body.append(name, company, email);

  /* --- Deal value, status badge, delete button --- */
  const actions = document.createElement('div');
  actions.className = 'client-card__actions';

  const figures = document.createElement('div');
  figures.className = 'stack-2';
  figures.style.justifyItems = 'end';

  const value = document.createElement('span');
  value.className = 'client-card__value';
  value.textContent = formatMoney(client.dealValue);

  figures.append(value, createStatusBadge(client.status));

  /* Status dropdown, so a deal can be moved along without opening anything.
     Options come from CLIENT_STATUSES, so a new stage appears here for free. */
  const statusSelect = document.createElement('select');
  statusSelect.className = 'select';
  statusSelect.style.minWidth = '150px';
  statusSelect.dataset.action = 'status';
  statusSelect.setAttribute('aria-label', `Deal stage for ${client.name}`);
  CLIENT_STATUSES.forEach((status) => {
    const option = document.createElement('option');
    option.value = status;
    option.textContent = status;
    if (status === client.status) option.selected = true;
    statusSelect.append(option);
  });

  const editButton = document.createElement('button');
  editButton.className = 'btn btn--sm';
  editButton.type = 'button';
  editButton.dataset.action = 'edit';
  editButton.textContent = 'Edit';
  editButton.setAttribute('aria-label', `Edit ${client.name}`);

  const deleteButton = document.createElement('button');
  deleteButton.className = 'btn btn--danger btn--sm';
  deleteButton.type = 'button';
  deleteButton.dataset.action = 'delete';
  deleteButton.textContent = 'Delete';
  /* Screen readers hear "Delete" on every card otherwise, with no way to tell
     which one is which. */
  deleteButton.setAttribute('aria-label', `Delete ${client.name}`);

  actions.append(figures, statusSelect, editButton, deleteButton);
  card.append(avatar, body, actions);

  return card;
}

/**
 * The coloured status badge.
 *
 * The class name is derived from the status rather than chosen by a switch
 * statement listing all four, so adding a fifth status needs no change here.
 */
function createStatusBadge(status) {
  const badge = document.createElement('span');
  badge.className = `badge badge--${status.toLowerCase()}`;
  badge.textContent = status;
  return badge;
}

/**
 * Draw a list of clients. THE render function — every action ends by calling
 * this, so there is exactly one code path that puts clients on screen.
 *
 * Cards are assembled into a DocumentFragment first and added to the page in a
 * single operation, so the browser lays out the page once instead of thirty
 * times.
 */
function renderClients(list) {
  listEl.replaceChildren();          // clear whatever was there

  if (list.length === 0) {
    listEl.append(createStateBlock('No clients found.'));
    return;
  }

  const fragment = document.createDocumentFragment();
  list.forEach((client) => fragment.append(createClientCard(client)));
  listEl.append(fragment);
}

/**
 * Redraw the list through the current toolbar settings.
 *
 * Everything that changes data calls this rather than renderClients directly,
 * so an edit made while a filter is active respects that filter instead of
 * silently showing the whole list again.
 */
function refresh() {
  const visible = getVisibleClients(clients, view);
  renderClients(visible);

  const count = document.getElementById('result-count');
  if (count) count.textContent = `${visible.length} of ${clients.length}`;
}

/** A centred message block, used for the loading, empty and error states. */
function createStateBlock(message, { error = false, extra = null, spinner = false } = {}) {
  const block = document.createElement('div');
  block.className = error ? 'state state--error' : 'state';

  if (spinner) {
    const spin = document.createElement('div');
    spin.className = 'spinner';
    block.append(spin);
  }

  const text = document.createElement('p');
  text.className = spinner ? 'state__msg cursor' : 'state__msg';
  text.textContent = message;
  block.append(text);

  if (extra) block.append(extra);
  return block;
}

/* ==================================================================
   Loading
   ================================================================== */

/**
 * Fill the page with clients, showing progress and failures honestly.
 *
 * The try/catch is what turns a network failure into a message the user can
 * act on instead of an empty screen and an error in a console they will never
 * open. The Retry button simply calls this function again.
 */
async function initClients() {
  listEl.replaceChildren(
    createStateBlock('Loading clients...', { spinner: true })
  );

  try {
    clients = await loadClients();
    refresh();
  } catch (error) {
    console.error('Could not load clients.', error);

    const retry = document.createElement('button');
    retry.className = 'btn btn--danger';
    retry.type = 'button';
    retry.textContent = 'Retry';
    retry.addEventListener('click', initClients);

    listEl.replaceChildren(
      createStateBlock(
        'Could not load clients. Check your connection and try again.',
        { error: true, extra: retry }
      )
    );
  }
}

/* ==================================================================
   Adding a client
   ================================================================== */

/** Fill the status dropdown from the shared list, so it cannot drift. */
function populateStatusOptions() {
  const select = document.getElementById('client-status');
  CLIENT_STATUSES.forEach((status) => {
    const option = document.createElement('option');
    option.value = status;
    option.textContent = status;
    if (status === DEFAULT_STATUS) option.selected = true;
    select.append(option);
  });
}

/**
 * Open the form.
 *
 * With no id it creates; with an id it loads that client in and replaces.
 * The window title and button label change too, so it is never ambiguous
 * which of the two is about to happen.
 */
function openClientModal(id = null) {
  editingClientId = id;

  const title = document.getElementById('add-client-title');
  const submitButton = document.getElementById('submit-add-client');

  if (id === null) {
    title.textContent = 'ADD_CLIENT.EXE';
    submitButton.textContent = 'Add Client';
    addFormEl.reset();
    addFormEl.elements.status.value = DEFAULT_STATUS;
  } else {
    const client = clients.find((item) => item.id === id);
    if (!client) return;

    title.textContent = 'EDIT_CLIENT.EXE';
    submitButton.textContent = 'Save Client';

    const fields = addFormEl.elements;
    fields.name.value = client.name;
    fields.email.value = client.email;
    fields.phone.value = client.phone || '';
    fields.company.value = client.company || '';
    fields.dealValue.value = client.dealValue;
    fields.status.value = client.status;
  }

  clearFieldErrors(addFormEl);
  overlayEl.hidden = false;
  document.getElementById('client-name').focus();
}

function closeAddClientModal() {
  overlayEl.hidden = true;
  editingClientId = null;
  addFormEl.reset();
  clearFieldErrors(addFormEl);
}

/**
 * Check the Add Client form. Returns { fieldId: message } for what failed.
 *
 * As on the signup form, every rule runs on every submit so the user sees all
 * the problems at once rather than one per attempt.
 */
function validateNewClient(values) {
  const errors = {};

  if (!isLongEnough(values.name, MIN_NAME_LENGTH)) {
    errors['client-name'] = 'Name must be at least 3 characters';
  }

  if (!isValidEmail(values.email)) {
    errors['client-email'] = 'Please enter a valid email address';
  } else if (clientEmailExists(values.email)) {
    errors['client-email'] = 'A client with this email already exists';
  }

  /* Phone is optional — only checked when the user actually typed something. */
  if (values.phone.trim() !== '' && values.phone.trim().length < MIN_PHONE_LENGTH) {
    errors['client-phone'] = 'Phone number looks too short';
  }

  if (!isPositiveNumber(values.dealValue)) {
    errors['client-value'] = 'Deal value must be a positive number';
  }

  return errors;
}

/**
 * True if this email already belongs to another client.
 *
 * The client currently being edited is skipped. Without that, saving an edit
 * without changing the email would report "already exists" — the record would
 * be colliding with itself.
 */
function clientEmailExists(email) {
  const wanted = email.trim().toLowerCase();
  return clients.some(
    (client) => client.email.toLowerCase() === wanted && client.id !== editingClientId
  );
}

async function handleAddClient(event) {
  event.preventDefault();

  /*
    Read through form.elements, NOT straight off the form.

    A form element already owns a property called `name` (the form's own name
    attribute), and that real property wins over the lookup-a-field-by-name
    shortcut. So addFormEl.name would hand back an empty string rather than the
    Name input, and .value on it would be undefined — the client would be saved
    called "undefined" and the length check would pass, because the word
    "undefined" is nine characters long. form.elements has no such clash.
  */
  const fields = addFormEl.elements;

  const values = {
    name: fields.name.value,
    email: fields.email.value,
    phone: fields.phone.value,
    company: fields.company.value,
    dealValue: fields.dealValue.value,
    status: fields.status.value,
  };

  clearFieldErrors(addFormEl);

  const errors = validateNewClient(values);
  const failed = Object.keys(errors);

  if (failed.length > 0) {
    failed.forEach((field) => setFieldError(field, errors[field]));
    document.getElementById(failed[0]).focus();
    return;
  }

  /* The values to send and store. Called payload rather than newClient
     because the same object is used for both creating and editing. */
  const payload = {
    name: values.name.trim(),
    email: values.email.trim().toLowerCase(),
    phone: values.phone.trim(),
    company: values.company.trim(),
    image: '',                       // no upload: the card falls back to initials
    status: values.status,
    dealValue: Number(values.dealValue),
    notes: [],
    /* The real clock. Only the thirty starter records get invented history;
       anything you create yourself is stamped with the actual time, so your
       genuine activity stays separated from the demo data. */
    createdAt: new Date().toISOString(),
    closedAt: isClosedStatus(values.status) ? new Date().toISOString() : '',
  };

  /* Disable the button while the request is in flight, so an impatient double
     click cannot submit the same thing twice. */
  const submitButton = document.getElementById('submit-add-client');
  submitButton.disabled = true;

  try {
    if (editingClientId === null) {
      /* --- Creating: POST, then put the new client at the top --- */
      const saved = await createClientOnApi(payload);

      /*
        Take the server's id, but only if it is actually free.

        DummyJSON hands out the same id to every POST, because it never really
        stores anything — the "next" id is always 30 + 1. Trusting it blindly
        would give the second and third clients you add identical ids, and then
        deleting one would delete all of them, since the delete filters by id.
        Date.now() is guaranteed unique here because two adds cannot land in
        the same millisecond.
      */
      const idIsFree = saved.id && !clients.some((item) => item.id === saved.id);
      payload.id = idIsFree ? saved.id : Date.now();

      /* unshift, not push: newest client appears at the top of the list. */
      clients.unshift(payload);
      saveClients(clients);
      refresh();

      closeAddClientModal();
      showToast('Client added ✓', 'success');
    } else {
      /* --- Editing: PUT, then replace the fields in place --- */
      await updateClientOnApi(editingClientId, payload);

      const client = clients.find((item) => item.id === editingClientId);

      /*
        Overwrite only the editable fields. id, notes and createdAt are
        deliberately left alone: rewriting createdAt would move the client to
        the top of "Newest first" every time it was edited, and rewriting
        notes would wipe the entire conversation history.
      */
      client.name = payload.name;
      client.email = payload.email;
      client.phone = payload.phone;
      client.company = payload.company;
      client.status = payload.status;
      client.dealValue = payload.dealValue;

      saveClients(clients);
      refresh();

      closeAddClientModal();
      showToast('Client updated ✓', 'success');
    }
  } catch (error) {
    console.error('Could not save client.', error);
    showToast('Could not save client. Check your connection and try again.', 'error');
  } finally {
    /* finally runs whether the request succeeded or threw, so the button can
       never be left permanently disabled. */
    submitButton.disabled = false;
  }
}

/* ==================================================================
   Deleting a client
   ================================================================== */

/**
 * Delete after confirming.
 *
 * confirm() is the one browser dialog the assignment allows, and only here:
 * blocking the page for a genuinely destructive action is the point.
 *
 * The client is removed locally whether or not the server agrees. A client you
 * added yourself was never really stored by DummyJSON, so deleting it returns
 * 404 — refusing to remove something the user can see, because a fake backend
 * disagreed, would be the wrong call.
 */
async function handleDeleteClient(id) {
  const client = clients.find((item) => item.id === id);
  if (!client) return;

  if (!confirm('Delete this client? This cannot be undone.')) return;

  await deleteClientOnApi(id);

  clients = clients.filter((item) => item.id !== id);
  saveClients(clients);
  refresh();

  showToast('Client deleted', 'success');
}

/* ==================================================================
   Changing a deal stage
   ================================================================== */

/**
 * Move a client to a different stage.
 *
 * The three-step cycle the whole app runs on: change the state, save it,
 * redraw. Going through refresh() rather than renderClients matters here —
 * if the user is filtering by "Lead" and moves someone to "Won", that client
 * should disappear from the list, which only happens if the filter is
 * reapplied.
 */
function handleStatusChange(id, newStatus) {
  const client = clients.find((item) => item.id === id);
  if (!client) return;

  client.status = newStatus;

  /* Record when a deal actually finished, so the analytics page can measure
     how long deals take rather than guess. Moving a client back out of Won or
     Lost clears it again — a deal that has reopened has no closing date, and
     leaving a stale one would quietly corrupt every velocity figure. */
  client.closedAt = isClosedStatus(newStatus) ? new Date().toISOString() : '';

  saveClients(clients);
  refresh();

  showToast(`${client.name} moved to ${newStatus}`, 'success');
}

/* ==================================================================
   Toolbar: search, filter chips, sort
   ================================================================== */

function populateSortOptions() {
  const select = document.getElementById('sort');
  /* SORT_OPTIONS lives in data.js next to the sorting code itself, so the
     labels and the behaviour cannot drift apart. */
  Object.entries(SORT_OPTIONS).forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  });
}

/** Build "All" plus one chip per status, straight from CLIENT_STATUSES. */
function populateFilterChips() {
  const container = document.getElementById('filter-chips');

  ['All', ...CLIENT_STATUSES].forEach((status) => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.type = 'button';
    chip.dataset.status = status;
    chip.textContent = status;
    /* aria-pressed carries the state for assistive technology, and the CSS
       styles the active chip from that same attribute — one source of truth
       rather than a class and an ARIA attribute that can disagree. */
    chip.setAttribute('aria-pressed', String(status === view.status));
    container.append(chip);
  });
}

function setUpToolbarEvents() {
  /* Search runs on every keystroke. No debounce is needed because nothing
     leaves the browser — this filters an array already in memory. */
  document.getElementById('search').addEventListener('input', (event) => {
    view.search = event.target.value;
    refresh();
  });

  document.getElementById('sort').addEventListener('change', (event) => {
    view.sort = event.target.value;
    refresh();
  });

  document.getElementById('filter-chips').addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;

    view.status = chip.dataset.status;

    /* Exactly one chip is pressed at a time. */
    document.querySelectorAll('#filter-chips .chip').forEach((other) => {
      other.setAttribute('aria-pressed', String(other === chip));
    });

    refresh();
  });
}

/* ==================================================================
   Client detail window: full information, notes, reminder
   ================================================================== */

function openDetail(id) {
  const client = clients.find((item) => item.id === id);
  if (!client) return;

  openClientId = id;

  /* Uploaded photo, else the API image, else initials. */
  document.getElementById('detail-avatar')
    .replaceChildren(createAvatar(client.avatar || client.image, client.name, 'avatar--lg'));

  /* Remove is only offered for a photo this user actually uploaded. The
     API's own image is not theirs to delete. */
  document.getElementById('client-avatar-remove').hidden = !client.avatar;
  document.querySelector('[data-error-for="client-avatar-input"]').textContent = '';

  /* textContent throughout — this window shows the same untrusted names and
     companies the cards do. */
  document.getElementById('detail-name').textContent = client.name;
  document.getElementById('detail-company').textContent = client.company || '—';
  document.getElementById('detail-email').textContent = client.email;
  document.getElementById('detail-phone').textContent = client.phone || '—';
  document.getElementById('detail-since').textContent =
    `Client since ${formatDate(client.createdAt)}`;

  const figures = document.getElementById('detail-figures');
  const value = document.createElement('span');
  value.className = 'client-card__value';
  value.textContent = formatMoney(client.dealValue);
  figures.replaceChildren(createStatusBadge(client.status), value);

  renderNotes(client);
  detailEl.hidden = false;
}

function closeDetail() {
  detailEl.hidden = true;
  openClientId = null;
  document.getElementById('note-form').reset();
}

/** Draw the note history, oldest first so it reads as a timeline. */
function renderNotes(client) {
  const list = document.getElementById('note-list');
  list.replaceChildren();

  if (client.notes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-faint';
    empty.style.fontSize = 'var(--fs-sm)';
    empty.textContent = 'No notes yet.';
    list.append(empty);
    return;
  }

  client.notes.forEach((note) => {
    const item = document.createElement('div');
    item.className = 'note';

    const text = document.createElement('span');
    text.className = 'note__text';
    text.textContent = note.text;

    const date = document.createElement('span');
    date.className = 'note__date';
    date.textContent = note.date;

    item.append(text, date);
    list.append(item);
  });

  /* Keep the newest note in view without moving the whole page. */
  list.scrollTop = list.scrollHeight;
}

function handleAddNote(event) {
  event.preventDefault();

  const input = document.getElementById('note-text');
  const text = input.value.trim();

  /* An empty or whitespace-only note is silently ignored rather than shown as
     an error — the user has not made a mistake, they just have nothing to add. */
  if (text === '') return;

  const client = clients.find((item) => item.id === openClientId);
  if (!client) return;

  const now = new Date();

  client.notes.push({
    text,
    /* toLocaleString gives date and time in the reader's own format. */
    date: now.toLocaleString(),
    /*
      The same instant again, in ISO form.

      `date` is a display string in whatever format the reader's locale uses,
      so 05/07/2026 means the fifth of July to one person and the seventh of
      May to another. That is fine to show and impossible to compute with.
      The analytics page needs to answer "when did anyone last touch this
      client", and it cannot do that from a string whose meaning depends on
      who is looking at it. One is for reading, one is for arithmetic.
    */
    at: now.toISOString(),
  });

  saveClients(clients);
  renderNotes(client);
  input.value = '';
  input.focus();
}

/**
 * Follow-up reminder.
 *
 * setTimeout schedules the message and returns immediately, so the timer keeps
 * running even after the window is closed or another client is opened. The
 * client's name is captured now, in this function's scope, rather than read
 * from openClientId a minute later — by then the user will almost certainly be
 * looking at something else and the reminder would name the wrong person.
 */
function handleRemind() {
  const client = clients.find((item) => item.id === openClientId);
  if (!client) return;

  const name = client.name;
  showToast('Reminder set ✓', 'success');

  setTimeout(() => {
    showToast(`⏰ Follow up: ${name}`, 'info');
  }, REMINDER_DELAY_MS);
}

/* ==================================================================
   Wiring
   ================================================================== */

/**
 * One click listener on the container instead of one per button.
 *
 * Cards are rebuilt on every render, so per-card listeners would have to be
 * re-attached every time and any that were missed would leak. Listening on the
 * parent and asking what was clicked survives any number of redraws — this is
 * event delegation, and it is why the buttons carry data-action and the cards
 * carry data-id.
 */
function setUpListEvents() {
  listEl.addEventListener('click', (event) => {
    const card = event.target.closest('.client-card');
    if (!card) return;

    /* dataset values are always strings; ids are numbers. */
    const id = Number(card.dataset.id);
    const control = event.target.closest('[data-action]');

    if (control?.dataset.action === 'delete') {
      handleDeleteClient(id);
      return;
    }

    if (control?.dataset.action === 'edit') {
      openClientModal(id);
      return;
    }

    /* Clicking a control must not also open the details window, so anything
       inside a [data-action] element stops here. Everything else on the card
       counts as "show me this client". */
    if (control) return;

    openDetail(id);
  });

  /* change, not click: a <select> fires change when its value is committed.
     It is a separate listener because change does not bubble the same way for
     every control, and mixing the two would make this harder to follow. */
  listEl.addEventListener('change', (event) => {
    const select = event.target.closest('[data-action="status"]');
    if (!select) return;

    const card = select.closest('.client-card');
    if (!card) return;

    handleStatusChange(Number(card.dataset.id), select.value);
  });
}

function setUpModalEvents() {
  document.getElementById('open-add-client')
    .addEventListener('click', () => openClientModal(null));

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', closeAddClientModal);
  });

  /* Clicking the dimmed background closes the window, but only when the click
     landed on the backdrop itself — without this check, a click that started
     inside the form would also close it. */
  overlayEl.addEventListener('click', (event) => {
    if (event.target === overlayEl) closeAddClientModal();
  });

  addFormEl.addEventListener('submit', handleAddClient);
  enableLiveErrorClearing(addFormEl);
}

function setUpDetailEvents() {
  document.querySelectorAll('[data-close-detail]').forEach((button) => {
    button.addEventListener('click', closeDetail);
  });

  detailEl.addEventListener('click', (event) => {
    if (event.target === detailEl) closeDetail();
  });

  document.getElementById('note-form').addEventListener('submit', handleAddNote);
  document.getElementById('remind-btn').addEventListener('click', handleRemind);

  document.getElementById('client-avatar-input')
    .addEventListener('change', handleClientAvatarChange);
  document.getElementById('client-avatar-remove')
    .addEventListener('click', handleClientAvatarRemove);
}

/**
 * Attach an uploaded photo to the open client.
 *
 * Stored on the client record itself, inside the existing crm_clients key —
 * no new storage key, so the four the assignment specifies stay exactly four.
 *
 * The image is cropped and re-encoded to 128x128 by readImageAsAvatar() before
 * it is ever written, which is what makes storing one per client affordable:
 * about 6KB each, so thirty of them is well under a tenth of the budget.
 */
async function handleClientAvatarChange(event) {
  const input = event.target;
  const file = input.files[0];
  const errorSlot = document.querySelector('[data-error-for="client-avatar-input"]');

  errorSlot.textContent = '';
  if (!file || openClientId === null) return;

  try {
    const dataUrl = await readImageAsAvatar(file);
    const client = clients.find((item) => item.id === openClientId);
    if (!client) return;

    client.avatar = dataUrl;

    /* saveClients() reports a failed write rather than throwing. The realistic
       cause is a full quota, and a photo that silently fails to save is far
       more confusing than one that says so. */
    if (!saveClients(clients)) {
      client.avatar = '';
      errorSlot.textContent = 'Not enough browser storage left to save that photo';
      return;
    }

    openDetail(openClientId);   // redraw the window with the new photo
    refresh();                  // and the card behind it
    showToast('Photo updated ✓', 'success');
  } catch (error) {
    errorSlot.textContent = error.message;
  } finally {
    /* Reset so picking the same file twice still fires a change event. */
    input.value = '';
  }
}

function handleClientAvatarRemove() {
  const client = clients.find((item) => item.id === openClientId);
  if (!client) return;

  client.avatar = '';
  saveClients(clients);
  openDetail(openClientId);
  refresh();
  showToast('Photo removed', 'info');
}

/**
 * Escape closes whichever window is open.
 *
 * One listener on the document rather than one per window, so the two can
 * never both react to the same key press.
 */
function setUpEscapeKey() {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    if (!shortcutsEl.hidden) closeShortcuts();
    else if (!detailEl.hidden) closeDetail();
    else if (!overlayEl.hidden) closeAddClientModal();
  });
}

/* ==================================================================
   Keyboard shortcuts and the easter egg (bonus features)
   ================================================================== */

const shortcutsEl = document.getElementById('shortcuts-overlay');

function closeShortcuts() {
  shortcutsEl.hidden = true;
}

/* isTyping() now lives in app.js. Two separate features needed it — these
   shortcuts and the Konami easter egg — and once the easter egg moved to
   app.js so it would work on every page, keeping a second copy here would
   have been exactly the duplication P5.6 forbids. app.js loads before this
   file, so the function is already defined by the time anything calls it. */

/** True when any window is open — shortcuts should not fire behind a dialog. */
function aModalIsOpen() {
  return !overlayEl.hidden || !detailEl.hidden || !shortcutsEl.hidden;
}

/**
 * Single-key shortcuts.
 *
 * Two guards make this safe. Typing "n" into the search box must type an "n",
 * not open a window, so anything typed into a field is ignored. And a shortcut
 * must not act on the list hidden behind an open dialog.
 *
 * event.key is the character produced, which respects the user's keyboard
 * layout, unlike event.keyCode which describes a physical key position.
 */
function setUpShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (isTyping(event.target)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (aModalIsOpen() && event.key !== '?') return;

    /* "/" focuses search — the convention on most sites with a search box. */
    if (event.key === '/') {
      event.preventDefault();      // stop Firefox opening its quick-find bar
      document.getElementById('search').focus();
      return;
    }

    if (event.key === 'n' || event.key === 'N') {
      openClientModal(null);
      return;
    }

    if (event.key === '?') {
      shortcutsEl.hidden = !shortcutsEl.hidden;
      return;
    }

    /* 1-5 pick a filter chip, in the order they appear on screen. */
    const position = Number(event.key);
    if (position >= 1 && position <= 5) {
      const chips = document.querySelectorAll('#filter-chips .chip');
      if (chips[position - 1]) chips[position - 1].click();
    }
  });

  document.querySelectorAll('[data-close-shortcuts]').forEach((button) => {
    button.addEventListener('click', closeShortcuts);
  });

  shortcutsEl.addEventListener('click', (event) => {
    if (event.target === shortcutsEl) closeShortcuts();
  });
}

/* The Konami easter egg used to be defined here, which was a mistake: it was
   only ever wired up on this one page, so entering the code anywhere else in
   the app did nothing and it looked broken. It now lives in app.js alongside
   the guard, the theme and the navigation — the other three things that have
   to behave identically on every page. */

/*
  Do nothing at all if the auth guard is already redirecting.

  window.location.href starts a navigation but does not halt the page, so
  without this check an unauthenticated visitor would still trigger the API
  request, have thirty clients written into their storage, and see the list
  painted for an instant before the browser finally moved them to the login
  page. isRedirecting is set by js/app.js in the <head>.
*/
if (!isRedirecting) {
  populateStatusOptions();
  populateSortOptions();
  populateFilterChips();
  setUpListEvents();
  setUpModalEvents();
  setUpDetailEvents();
  setUpToolbarEvents();
  setUpEscapeKey();
  setUpShortcuts();
  initClients();
}
