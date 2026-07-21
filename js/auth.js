/**
 * auth.js — registration (P1) and login (P2).
 *
 * One file serves both pages. Each page contains only one of the two forms, so
 * the matching setup function runs and the other simply finds nothing.
 *
 * Loaded at the end of the body, after js/storage.js and js/ui.js.
 */

/* How long the success message stays on screen before the redirect, so the
   user can actually read it. The assignment specifies 1.5 seconds. */
const SIGNUP_REDIRECT_MS = 1500;

/* ==================================================================
   P1 — Sign Up
   ================================================================== */

/**
 * Check all five fields and return an object of { fieldId: message }.
 *
 * Every rule is checked on every submit rather than stopping at the first
 * failure, because the assignment requires all errors to appear together. A
 * form that reveals one problem at a time makes the user submit five times to
 * discover five problems.
 */
function validateSignup(values) {
  const errors = {};

  if (!isLongEnough(values.fullName, MIN_NAME_LENGTH)) {
    errors.fullName = 'Full name must be at least 3 characters';
  }

  /* Format is checked first; only if the address is well-formed is it worth
     asking whether it is already taken. */
  if (!isValidEmail(values.email)) {
    errors.email = 'Please enter a valid email address';
  } else if (emailIsTaken(values.email)) {
    errors.email = 'An account with this email already exists';
  }

  /* Company is optional and has no rule at all. */

  if (!isValidPassword(values.password)) {
    errors.password =
      'Password must be at least 8 characters and contain a letter and a number';
  }

  if (values.confirmPassword !== values.password) {
    errors.confirmPassword = 'Passwords do not match';
  }

  return errors;
}

function setUpSignupForm() {
  const form = document.getElementById('signup-form');
  if (!form) return;

  enableLiveErrorClearing(form);

  form.addEventListener('submit', (event) => {
    /* Stop the browser's default submit, which would reload the page and throw
       away everything typed. Without this line nothing below ever runs. */
    event.preventDefault();

    const values = {
      fullName: form.fullName.value,
      email: form.email.value,
      company: form.company.value,
      password: form.password.value,
      confirmPassword: form.confirmPassword.value,
    };

    /* Wipe previous messages so corrected fields stop showing old errors. */
    clearFieldErrors(form);

    const errors = validateSignup(values);
    const failedFields = Object.keys(errors);

    if (failedFields.length > 0) {
      failedFields.forEach((field) => setFieldError(field, errors[field]));
      /* Move focus to the first problem so keyboard users are not left
         hunting for which field broke. */
      document.getElementById(failedFields[0]).focus();
      return;  // nothing is saved when the form is invalid
    }

    /* Valid — build the account exactly in the shape the assignment specifies. */
    const newUser = {
      id: Date.now(),                              // simple unique id
      fullName: values.fullName.trim(),
      email: values.email.trim().toLowerCase(),    // stored lowercase
      password: values.password,                   // see the note in storage.js
      company: values.company.trim(),              // may be an empty string
      createdAt: new Date().toISOString(),
    };

    const users = getUsers();
    users.push(newUser);
    saveUsers(users);

    showToast('Account created successfully! Please log in.', 'success');

    /* Pause so the message is readable, then move to the login page. */
    setTimeout(() => {
      window.location.href = 'index.html';
    }, SIGNUP_REDIRECT_MS);
  });
}

/* ==================================================================
   P2 — Log In
   ================================================================== */

function setUpLoginForm() {
  const form = document.getElementById('login-form');
  if (!form) return;

  enableLiveErrorClearing(form);

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const email = form.email.value;
    const password = form.password.value;

    clearFieldErrors(form);

    /* Step 1 — are the boxes filled in at all? */
    let hasEmptyField = false;

    if (email.trim() === '') {
      setFieldError('email', 'Email is required');
      hasEmptyField = true;
    }
    if (password === '') {
      setFieldError('password', 'Password is required');
      hasEmptyField = true;
    }
    if (hasEmptyField) return;

    /* Step 2 — do these credentials match an account? */
    const user = findUserByEmail(email);

    if (!user || user.password !== password) {
      /*
        One deliberately vague message for both failures.

        Saying "no account with that email" would tell an attacker which
        addresses are registered, which they could then target with password
        guessing or a convincing phishing email. Real products keep the two
        cases indistinguishable for exactly this reason.

        The border goes on both fields because we are not revealing which one
        was wrong.
      */
      document.getElementById('email').classList.add('input-error');
      setFieldError('password', 'Invalid email or password');
      form.password.value = '';
      form.password.focus();
      return;
    }

    /* Step 3 — success. Record who is logged in and when. */
    saveSession({
      userId: user.id,
      email: user.email,
      loginAt: new Date().toISOString(),
    });

    /* No toast here: the redirect is immediate, so a message would be wiped
       off the screen before it could be read. */
    window.location.href = 'dashboard.html';
  });
}

/* Run both. Only the form that exists on this page will be wired up. */
setUpSignupForm();
setUpLoginForm();
