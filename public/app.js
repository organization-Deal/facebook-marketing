const els = {
  chats: document.querySelector('#chats'),
  leads: document.querySelector('#leads'),
  qualified: document.querySelector('#qualified'),
  closed: document.querySelector('#closed'),
  conversion: document.querySelector('#conversion'),
  revenue: document.querySelector('#revenue'),
  contentRows: document.querySelector('#contentRows'),
  keywordList: document.querySelector('#keywordList'),
  messageRows: document.querySelector('#messageRows'),
  seedBtn: document.querySelector('#seedBtn'),
  refreshBtn: document.querySelector('#refreshBtn'),
  mockForm: document.querySelector('#mockForm'),
  mockText: document.querySelector('#mockText'),
  mockRef: document.querySelector('#mockRef'),
  notice: document.querySelector('#notice')
};

const money = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat('th-TH');

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function refresh() {
  const [dashboard, messages] = await Promise.all([
    api('/api/dashboard'),
    api('/api/messages?limit=30')
  ]);
  renderSummary(dashboard.summary);
  renderContents(dashboard.topContents);
  renderKeywords(dashboard.topKeywords);
  renderMessages(messages.messages);
}

function renderSummary(summary) {
  els.chats.textContent = integer.format(summary.chats);
  els.leads.textContent = integer.format(summary.leads);
  els.qualified.textContent = integer.format(summary.qualified);
  els.closed.textContent = integer.format(summary.closed);
  els.conversion.textContent = `${summary.leadToClosePct}%`;
  els.revenue.textContent = money.format(summary.revenue);
}

function renderContents(rows) {
  if (!rows.length) {
    els.contentRows.innerHTML = '<tr><td colspan="5" class="muted">ยังไม่มีข้อมูล — กด “ใส่ข้อมูล Demo” ได้เลย</td></tr>';
    return;
  }
  els.contentRows.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.name)}</td>
      <td>${integer.format(Number(row.reach || 0))}</td>
      <td>${integer.format(Number(row.chats || 0))}</td>
      <td>${integer.format(Number(row.closed || 0))}</td>
      <td>${money.format(Number(row.revenue || 0))}</td>
    </tr>
  `).join('');
}

function renderKeywords(rows) {
  if (!rows.length) {
    els.keywordList.innerHTML = '<div class="muted">ยังไม่มี Keyword</div>';
    return;
  }
  const max = Math.max(...rows.map((row) => Number(row.mentions || 0)), 1);
  els.keywordList.innerHTML = rows.map((row) => {
    const pct = Math.max(8, (Number(row.mentions || 0) / max) * 100);
    return `
      <div class="keyword">
        <div class="keyword-main">
          <div class="keyword-label">${escapeHtml(row.keyword)}</div>
          <div class="keyword-track"><div class="keyword-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="keyword-count">${integer.format(Number(row.mentions || 0))}</div>
      </div>`;
  }).join('');
}

function renderMessages(rows) {
  if (!rows.length) {
    els.messageRows.innerHTML = '<tr><td colspan="6" class="muted">ยังไม่มีข้อความ</td></tr>';
    return;
  }
  els.messageRows.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.message_text || '—')}</td>
      <td>${escapeHtml(row.source || 'unknown')}</td>
      <td>${escapeHtml(row.intent || 'other')}</td>
      <td>${escapeHtml(row.product || '—')}</td>
      <td><span class="score">${integer.format(Number(row.lead_score || 0))}</span></td>
      <td><span class="status ${escapeHtml(row.lead_status || '')}">${escapeHtml(row.lead_status || 'new')}</span></td>
    </tr>
  `).join('');
}

function showNotice(message) {
  els.notice.textContent = message;
  els.notice.classList.remove('hidden');
  setTimeout(() => els.notice.classList.add('hidden'), 3500);
}

els.seedBtn.addEventListener('click', async () => {
  els.seedBtn.disabled = true;
  try {
    await api('/api/mock/seed', { method: 'POST' });
    showNotice('ใส่ข้อมูล Demo แล้ว');
    await refresh();
  } catch (error) {
    showNotice(`เกิดข้อผิดพลาด: ${error.message}`);
  } finally {
    els.seedBtn.disabled = false;
  }
});

els.refreshBtn.addEventListener('click', refresh);

els.mockForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/mock/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: els.mockText.value, ref: els.mockRef.value })
    });
    showNotice('รับ Mock Event แล้ว');
    await refresh();
  } catch (error) {
    showNotice(`เกิดข้อผิดพลาด: ${error.message}`);
  }
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

refresh().catch((error) => showNotice(`เปิด Dashboard ไม่สำเร็จ: ${error.message}`));
