function decodeReceipt() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const encoded = hash.get('data');
  if (!encoded) return null;
  try {
    const json = decodeURIComponent(escape(atob(encoded)));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function list(items) {
  if (!Array.isArray(items) || items.length === 0) return '<p class="empty">None recorded.</p>';
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function section(label, body) {
  return `<section class="panel"><div class="label">${label}</div>${body}</section>`;
}

const receipt = decodeReceipt();
const root = document.getElementById('receipt-root');

if (receipt && root) {
  const firstTest = receipt.firstTinyTasteTest
    ? `<p><strong>${escapeHtml(receipt.firstTinyTasteTest.title)}</strong><br>${escapeHtml(receipt.firstTinyTasteTest.cue)}<br><span class="empty">${escapeHtml(receipt.firstTinyTasteTest.estimatedTime)}</span></p>`
    : '<p class="empty">Not ready yet. Answer the family questions first.</p>';
  root.className = '';
  root.innerHTML = [
    section('Status', `<p>${escapeHtml(receipt.status || 'unknown')}</p><p class="empty">${escapeHtml(receipt.createdAt || '')}</p>`),
    '<div class="grid">',
    section('User-said', list(receipt.evidence?.userSaid)),
    section('Inferred', list(receipt.evidence?.inferred)),
    section('Researched', list(receipt.evidence?.researched)),
    section('Unknown', list(receipt.evidence?.unknown)),
    '</div>',
    section('Family Questions', list(receipt.nextBestQuestions)),
    section('First Tiny Taste Test', firstTest),
    section('Assistant Summary', `<p>${escapeHtml(receipt.assistantSummary || 'No final summary recorded.')}</p>`),
  ].join('');
}
