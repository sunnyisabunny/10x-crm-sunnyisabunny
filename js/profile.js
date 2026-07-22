/**
 * profile.js — the account page (P5).
 *
 * Three independent forms plus an identity block:
 *   1. Show who is logged in
 *   2. Edit name and company
 *   3. Change password
 *   4. Reset the client database
 *
 * Loaded after storage.js, ui.js and data.js.
 */

/* ==================================================================
   Identity block (P5.1)
   ================================================================== */

/**
 * Draw the current user's details and pre-fill the edit form.
 *
 * Called again after saving, so the block and the form both reflect the new
 * values without needing a page reload.
 */
function renderIdentity() {
  const user = getCurrentUser();
  if (!user) return;

  /* Initials rather than an uploaded photo — no file upload is in scope, and
     initials always work. */
  document.getElementById('id-avatar').textContent = getInitials(user.fullName);

  /* textContent, not innerHTML: the name and company are whatever the user
     typed at registration. */
  document.getElementById('id-name').textContent = user.fullName;
  document.getElementById('id-email').textContent = user.email;
  document.getElementById('id-company').textContent = user.company || '—';
  document.getElementById('id-since').textContent =
    `Member since ${formatDate(user.createdAt)}`;

  /* Pre-fill the edit form with the current values, so "Save Changes" after
     editing one field does not wipe the other. */
  const form = document.getElementById('profile-form');
  form.elements.fullName.value = user.fullName;
  form.elements.company.value = user.company || '';
}

/* ==================================================================
   Edit profile (P5.2)
   ================================================================== */

function handleProfileSubmit(event) {
  event.preventDefault();

  const form = event.target;
  const fields = form.elements;
  const fullName = fields.fullName.value;
  const company = fields.company.value;

  clearFieldErrors(form);

  /* Only the name has a rule. Company is optional and may be blank. */
  if (!isLongEnough(fullName, MIN_NAME_LENGTH)) {
    setFieldError('fullName', 'Full name must be at least 3 characters');
    fields.fullName.focus();
    return;
  }

  const user = getCurrentUser();
  if (!user) return;

  /* Only these two fields are passed, so updateUser merges them over the
     stored account and the password, id, email and createdAt are untouched. */
  updateUser(user.id, {
    fullName: fullName.trim(),
    company: company.trim(),
  });

  /* Redraw from storage rather than from the form values, which proves the
     save actually worked instead of just echoing what was typed. */
  renderIdentity();
  showToast('Profile updated ✓', 'success');
}

/* ==================================================================
   Change password (P5.3)
   ================================================================== */

/**
 * Validate a password change. Returns { fieldId: message } for what failed.
 *
 * Rules run in a deliberate order. The current password is checked first,
 * because if the person cannot prove who they are, nothing else matters and
 * telling them their new password is too short would be noise.
 */
function validatePasswordChange(user, values) {
  const errors = {};

  if (values.current !== user.password) {
    errors.currentPassword = 'Current password is incorrect';
  }

  if (!isValidPassword(values.next)) {
    errors.newPassword =
      'Password must be at least 8 characters and contain a letter and a number';
  } else if (values.next === user.password) {
    /* Only worth saying once the new password is otherwise valid — otherwise
       "abc" would report both problems at once and neither clearly. */
    errors.newPassword = 'New password must be different from the current one';
  }

  if (values.confirm !== values.next) {
    errors.confirmPassword = 'Passwords do not match';
  }

  return errors;
}

function handlePasswordSubmit(event) {
  event.preventDefault();

  const form = event.target;
  const fields = form.elements;

  const values = {
    current: fields.currentPassword.value,
    next: fields.newPassword.value,
    confirm: fields.confirmPassword.value,
  };

  clearFieldErrors(form);

  const user = getCurrentUser();
  if (!user) return;

  const errors = validatePasswordChange(user, values);
  const failed = Object.keys(errors);

  if (failed.length > 0) {
    failed.forEach((field) => setFieldError(field, errors[field]));
    document.getElementById(failed[0]).focus();
    return;
  }

  updateUser(user.id, { password: values.next });

  /* Clear all three boxes. Leaving a password sitting in a form after it has
     been used is careless, and the fields no longer mean anything. */
  form.reset();
  showToast('Password changed ✓', 'success');
}

/* ==================================================================
   Reset CRM data (P5.4)
   ================================================================== */

/**
 * Throw away every client and reload the original records from the API.
 *
 * Deliberately does NOT touch crm_users or crm_session: this resets the client
 * database, not the account. Logging the user out here would be a nasty
 * surprise from a button that says nothing about signing out.
 */
async function handleReset() {
  if (!confirm('Reset all client data? This cannot be undone.')) return;

  const button = document.getElementById('reset-btn');
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = 'Resetting...';

  try {
    /* Clear first, so that loadClients() sees nothing cached and goes to the
       API rather than handing back the very list we are trying to replace. */
    clearClients();

    const clients = await fetchClientsFromApi();
    saveClients(clients);

    showToast(`CRM data reset — ${clients.length} clients reloaded`, 'success');
  } catch (error) {
    console.error('Could not reset CRM data.', error);
    showToast('Could not load clients. Check your connection and try again.', 'error');
  } finally {
    /* finally runs on success and on failure, so the button can never be left
       disabled and mid-sentence. */
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

/* ==================================================================
   Start-up
   ================================================================== */

function initProfile() {
  renderIdentity();

  const profileForm = document.getElementById('profile-form');
  profileForm.addEventListener('submit', handleProfileSubmit);
  enableLiveErrorClearing(profileForm);

  const passwordForm = document.getElementById('password-form');
  passwordForm.addEventListener('submit', handlePasswordSubmit);
  enableLiveErrorClearing(passwordForm);

  document.getElementById('reset-btn').addEventListener('click', handleReset);
}

/* Do nothing if the auth guard is already redirecting — see js/app.js. */
if (!isRedirecting) {
  initProfile();
}
