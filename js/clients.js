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

/* Cached element references, looked up once instead of on every redraw. */
const listEl = document.getElementById('client-list');
const overlayEl = document.getElementById('add-client-overlay');
const addFormEl = document.getElementById('add-client-form');

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

  /* --- Avatar: the API image, or generated initials as a fallback --- */
  let avatar;
  if (client.image) {
    avatar = document.createElement('img');
    avatar.className = 'avatar';
    avatar.src = client.image;
    avatar.alt = '';           // decorative: the name is right next to it
    avatar.loading = 'lazy';
  } else {
    avatar = document.createElement('div');
    avatar.className = 'avatar avatar--initials';
    avatar.textContent = getInitials(client.name);
  }

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

  const deleteButton = document.createElement('button');
  deleteButton.className = 'btn btn--danger btn--sm';
  deleteButton.type = 'button';
  deleteButton.dataset.action = 'delete';
  deleteButton.textContent = 'Delete';
  /* Screen readers hear "Delete" on every card otherwise, with no way to tell
     which one is which. */
  deleteButton.setAttribute('aria-label', `Delete ${client.name}`);

  actions.append(figures, deleteButton);
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
    renderClients(clients);
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

function openAddClientModal() {
  overlayEl.hidden = false;
  document.getElementById('client-name').focus();
}

function closeAddClientModal() {
  overlayEl.hidden = true;
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

/** True if this email is already on the list (compared case-insensitively). */
function clientEmailExists(email) {
  const wanted = email.trim().toLowerCase();
  return clients.some((client) => client.email.toLowerCase() === wanted);
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

  const newClient = {
    name: values.name.trim(),
    email: values.email.trim().toLowerCase(),
    phone: values.phone.trim(),
    company: values.company.trim(),
    image: '',                       // no upload: the card falls back to initials
    status: values.status,
    dealValue: Number(values.dealValue),
    notes: [],
    createdAt: new Date().toISOString(),
  };

  /* Disable the button while the request is in flight, so an impatient double
     click cannot create the same client twice. */
  const submitButton = document.getElementById('submit-add-client');
  submitButton.disabled = true;

  try {
    const saved = await createClientOnApi(newClient);

    /*
      Take the server's id, but only if it is actually free.

      DummyJSON hands out the same id to every POST, because it never really
      stores anything — the "next" id is always 30 + 1. Trusting it blindly
      would give the second and third clients you add identical ids, and then
      deleting one would delete all of them, since the delete filters by id.
      Date.now() is guaranteed unique here because two adds cannot land in the
      same millisecond.
    */
    const idIsFree = saved.id && !clients.some((item) => item.id === saved.id);
    newClient.id = idIsFree ? saved.id : Date.now();

    /* unshift, not push: newest client appears at the top of the list. */
    clients.unshift(newClient);
    saveClients(clients);
    renderClients(clients);

    closeAddClientModal();
    showToast('Client added ✓', 'success');
  } catch (error) {
    console.error('Could not add client.', error);
    showToast('Could not add client. Check your connection and try again.', 'error');
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
  renderClients(clients);

  showToast('Client deleted', 'success');
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
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const card = button.closest('.client-card');
    if (!card) return;

    /* dataset values are always strings; ids are numbers. */
    const id = Number(card.dataset.id);

    if (button.dataset.action === 'delete') {
      handleDeleteClient(id);
    }
  });
}

function setUpModalEvents() {
  document.getElementById('open-add-client')
    .addEventListener('click', openAddClientModal);

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', closeAddClientModal);
  });

  /* Clicking the dimmed background closes the window, but only when the click
     landed on the backdrop itself — without this check, a click that started
     inside the form would also close it. */
  overlayEl.addEventListener('click', (event) => {
    if (event.target === overlayEl) closeAddClientModal();
  });

  /* Escape closes it too, which is what every desktop dialog does. */
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlayEl.hidden) closeAddClientModal();
  });

  addFormEl.addEventListener('submit', handleAddClient);
  enableLiveErrorClearing(addFormEl);
}

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
  setUpListEvents();
  setUpModalEvents();
  initClients();
}
