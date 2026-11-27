import * as api from '../api.js';
import { setSession } from '../auth.js';
import { icon } from '../components/icons.js';
import { escapeHtml } from '../utils.js';

const root = document.getElementById('login-root');

const state = {
  showPassword: false,
  loading: false,
  identifier: '',
  error: { title: '', message: '' },
};

const DEMO_ACCOUNTS = [
  { role: 'Owner', code: 'owner', email: 'owner@inventory.com', password: 'Owner@123' },
  { role: 'Product Manager', code: 'product', email: 'product@inventory.com', password: 'Product@123' },
  { role: 'Sales Manager', code: 'sales', email: 'sales@inventory.com', password: 'Sales@123' },
  { role: 'Stock Manager', code: 'stock', email: 'stock@inventory.com', password: 'Stock@123' },
  { role: 'Purchase Manager', code: 'purchase', email: 'purchase@inventory.com', password: 'Purchase@123' },
  { role: 'Order Manager', code: 'orders', email: 'orders@inventory.com', password: 'Orders@123' },
];

async function copyToClipboard(text) {
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand('copy');
    textarea.remove();
    return success;
  } catch {
    return false;
  }
}

function emailOrUsernameValid(value) {
  const text = value.trim();
  if (!text) return false;
  if (text.includes('@')) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text);
  }
  return /^[A-Za-z0-9._-]{3,}$/.test(text);
}

function render() {
  const errorHTML = state.error.message
    ? `<div class="form-error-banner" role="alert">
        ${icon(state.error.title.includes('deactivated') ? 'xCircle' : 'alertCircle', 16)}
        <span><strong>${escapeHtml(state.error.title)}</strong> ${escapeHtml(state.error.message)}</span>
      </div>`
    : '';

  root.innerHTML = `
    <div class="auth-card-head">
      <h2>Welcome back</h2>
      <p>Sign in to open your workspace.</p>
    </div>
    <div class="card">
      <form id="login-form" novalidate>
        <div class="stack-sm">
          ${errorHTML}
          <div class="form-field">
            <label for="login-identifier">Email or username <span class="req">*</span></label>
            <input type="text" id="login-identifier" name="identifier" placeholder="e.g. owner@inventory.com"
              autocomplete="username" aria-invalid="false" aria-describedby="identifier-error" value="${escapeHtml(state.identifier ?? '')}">
            <p class="field-error" id="identifier-error" aria-live="polite"></p>
          </div>
          <div class="form-field">
            <label for="login-password">Password <span class="req">*</span></label>
            <div class="password-wrap">
              <input type="${state.showPassword ? 'text' : 'password'}" id="login-password" name="password" placeholder="Enter your password"
                autocomplete="current-password" aria-invalid="false" aria-describedby="password-error">
              <button type="button" class="password-toggle" id="password-toggle" aria-label="${state.showPassword ? 'Hide password' : 'Show password'}" aria-pressed="${state.showPassword}">
                ${icon(state.showPassword ? 'eyeOff' : 'eye', 17)}
              </button>
            </div>
            <p class="field-error" id="password-error" aria-live="polite"></p>
          </div>
          <div class="check-row" style="margin-top:4px;">
            <label class="checkbox">
              <input type="checkbox" id="remember-me" name="remember">
              <span>Remember me</span>
            </label>
            <a href="#" id="forgot-password">Forgot password?</a>
          </div>
          <button type="submit" class="btn btn-primary btn-lg btn-block ${state.loading ? 'is-loading' : ''}" id="login-btn" ${state.loading ? 'disabled' : ''} style="margin-top:14px;">
            <span class="btn-label">${state.loading ? 'Signing in…' : 'Sign in'}</span>
          </button>
          <p class="auth-meta" style="margin-bottom:0;">
            Protected workspace · one account per role
          </p>
        </div>
      </form>
    </div>
    <details class="auth-notice" open>
      <summary>
        <span class="summary-left">${icon('shield', 15)} Demo accounts</span>
        <span class="summary-hint">Click Fill or Copy</span>
      </summary>
      <div class="demo-accounts-grid">
        ${DEMO_ACCOUNTS.map((account) => `
          <div class="demo-account-card">
            <div class="demo-account-top">
              <div class="demo-role-pill demo-role-${account.code}">
                <span class="demo-role-dot"></span>
                <span>${escapeHtml(account.role)}</span>
              </div>
              <div class="demo-card-actions">
                <button type="button" class="btn-demo-action btn-demo-fill"
                  data-fill="${escapeHtml(account.email)}"
                  data-fill-password="${escapeHtml(account.password)}"
                  data-role="${escapeHtml(account.role)}"
                  title="Auto-fill login credentials">
                  ${icon('arrowRight', 11)} Fill
                </button>
                <button type="button" class="btn-demo-action btn-demo-copy"
                  data-copy-email="${escapeHtml(account.email)}"
                  data-copy-password="${escapeHtml(account.password)}"
                  data-role="${escapeHtml(account.role)}"
                  title="Copy credentials to clipboard">
                  ${icon('copy', 11)} Copy
                </button>
              </div>
            </div>
            <div class="demo-cred-row">
              <span class="demo-cred-label">Email:</span>
              <code class="demo-cred-val" data-copy-single="${escapeHtml(account.email)}" title="Click to copy email">${escapeHtml(account.email)}</code>
            </div>
            <div class="demo-cred-row">
              <span class="demo-cred-label">Password:</span>
              <code class="demo-cred-val" data-copy-single="${escapeHtml(account.password)}" title="Click to copy password">${escapeHtml(account.password)}</code>
            </div>
          </div>
        `).join('')}
      </div>
    </details>
  `;

  bind();
}

function showErrors({ identifier, password }) {
  const emailError = root.querySelector('#identifier-error');
  const passwordError = root.querySelector('#password-error');
  const emailInput = root.querySelector('#login-identifier');
  const passwordInput = root.querySelector('#login-password');
  if (emailError) emailError.textContent = identifier || '';
  if (passwordError) passwordError.textContent = password || '';
  if (emailInput) emailInput.setAttribute('aria-invalid', identifier ? 'true' : 'false');
  if (passwordInput) passwordInput.setAttribute('aria-invalid', password ? 'true' : 'false');
}

function bind() {
  const form = root.querySelector('#login-form');
  const identifier = root.querySelector('#login-identifier');
  const password = root.querySelector('#login-password');
  const submitBtn = root.querySelector('#login-btn');

  identifier?.focus();
  identifier?.addEventListener('input', () => clearFieldError('identifier-error'));
  password?.addEventListener('input', () => clearFieldError('password-error'));

  identifier?.addEventListener('input', () => {
    state.identifier = identifier.value;
  });

  root.querySelector('#password-toggle')?.addEventListener('click', () => {
    state.showPassword = !state.showPassword;
    const input = root.querySelector('#login-password');
    const toggle = root.querySelector('#password-toggle');
    if (input) {
      input.type = state.showPassword ? 'text' : 'password';
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
    if (toggle) {
      toggle.innerHTML = icon(state.showPassword ? 'eyeOff' : 'eye', 17);
      toggle.setAttribute('aria-pressed', String(state.showPassword));
      toggle.setAttribute('aria-label', state.showPassword ? 'Hide password' : 'Show password');
    }
  });

  root.querySelector('#forgot-password')?.addEventListener('click', (event) => {
    event.preventDefault();
    showToastMessage('Password resets are handled by the Owner.', 'info');
  });

  root.querySelectorAll('.btn-demo-fill').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (identifier) {
        identifier.value = btn.dataset.fill;
        state.identifier = btn.dataset.fill;
      }
      if (password) {
        password.value = btn.dataset.fillPassword;
      }
      clearFieldError('identifier-error');
      clearFieldError('password-error');
      showToastMessage(`Filled credentials for ${btn.dataset.role || 'account'}`, 'info');
      password?.focus();
    });
  });

  root.querySelectorAll('.btn-demo-copy').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const email = btn.dataset.copyEmail;
      const pass = btn.dataset.copyPassword;
      const role = btn.dataset.role;
      const credText = `Email: ${email}\nPassword: ${pass}`;
      const ok = await copyToClipboard(credText);
      if (ok) {
        showToastMessage(`Copied ${role} credentials!`, 'success');
        const origContent = btn.innerHTML;
        btn.innerHTML = `${icon('check', 11)} Copied`;
        btn.classList.add('is-copied');
        setTimeout(() => {
          btn.innerHTML = origContent;
          btn.classList.remove('is-copied');
        }, 1500);
      } else {
        showToastMessage('Failed to copy credentials to clipboard.', 'error');
      }
    });
  });

  root.querySelectorAll('[data-copy-single]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const val = el.dataset.copySingle;
      const ok = await copyToClipboard(val);
      if (ok) {
        showToastMessage(`Copied: ${val}`, 'info');
      }
    });
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearInlineErrors();

    const identifierValue = identifier.value.trim();
    const passwordValue = password.value;

    let identifierError = '';
    let passwordError = '';
    if (!identifierValue) identifierError = 'Email or username is required.';
    else if (!emailOrUsernameValid(identifierValue)) identifierError = 'Enter a valid email or username.';
    if (!passwordValue) passwordError = 'Password is required.';

    showErrors({ identifier: identifierError, password: passwordError });
    if (identifierError) { identifier.focus(); return; }
    if (passwordError) { password.focus(); return; }

    state.identifier = identifierValue;
    state.loading = true;
    renderLoading();

    try {
      const { user, token } = await api.login(identifierValue, passwordValue);
      setSession({
        userId: user.id,
        token,
        loginAt: Date.now(),
        sessionVersion: user.sessionVersion,
      });
      window.location.href = '/app.html#/dashboard';
    } catch (error) {
      state.loading = false;
      renderLoading();
      if (error.code === 'DEACTIVATED') {
        state.error = { title: 'Account deactivated.', message: 'Contact the Owner.' };
      } else if (error.code === 'INVALID_CREDENTIALS') {
        state.error = { title: 'Invalid credentials.', message: 'Check your email/username and password.' };
      } else {
        state.error = { title: 'Sign-in failed.', message: error.message || 'Please try again.' };
      }
      render();
      root.querySelector('#login-identifier')?.focus();
    }
  });
}

function clearInlineErrors() {
  root.querySelectorAll('.field-error').forEach((el) => { el.textContent = ''; });
  root.querySelectorAll('[aria-invalid]').forEach((el) => el.setAttribute('aria-invalid', 'false'));
}

function clearFieldError(id) {
  const el = root.querySelector(`#${id}`);
  if (el) el.textContent = '';
  const input = el?.previousElementSibling?.querySelector ? el.previousElementSibling : null;
  if (input) input.setAttribute('aria-invalid', 'false');
}

function renderLoading() {
  const btn = root.querySelector('#login-btn');
  if (btn) {
    btn.disabled = state.loading;
    btn.classList.toggle('is-loading', state.loading);
    const label = btn.querySelector('.btn-label');
    if (label) label.textContent = state.loading ? 'Signing in…' : 'Sign in';
  }
}

function showToastMessage(message, type = 'info') {
  // lightweight inline toast for the login page
  let region = document.getElementById('toast-root');
  if (!region) {
    region = document.createElement('div');
    region.id = 'toast-root';
    region.className = 'toast-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const iconName = type === 'error' ? 'alertCircle' : type === 'warning' ? 'alertTriangle' : type === 'success' ? 'checkCircle' : 'info';
  el.innerHTML = `
    <div class="toast-icon">${icon(iconName, 14)}</div>
    <div><span>${escapeHtml(message)}</span></div>
  `;
  region.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  }, 3400);
}

render();
