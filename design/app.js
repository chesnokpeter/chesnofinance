import { accountBalance, totalBalance, monthlyTransactions, monthlyTotal, monthlyStats, localToday, parseMoney, formatMoney, saveTransaction, deleteTransaction } from './model.js';
import { openStore } from './store.js';
import { createManagement } from './management.js';
import { initPWA } from './pwa.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const icon = name => `<svg aria-hidden="true"><use href="#${name}"/></svg>`;
const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const longDate = new Intl.DateTimeFormat('ru-RU', {day:'numeric',month:'long'});
const shortDate = new Intl.DateTimeFormat('ru-RU', {day:'numeric',month:'short'});
const ui = {view:'home',month:localToday().slice(0,7),accountId:null,statType:'expense',expanded:new Set(),entryOpen:false,pickerOpen:false,saving:false,entry:null,lastAccountId:null};
let data, store, management, entryReturnFocus, pickerReturnFocus, toastTimer;

function account(id) { return data.accounts.find(item => item.id === id); }
function categoryInfo(type, categoryId, subcategoryId) {
  const category = data.categories[type]?.find(item => item.id === categoryId);
  return {category,sub:category?.subs.find(item => item.id === subcategoryId)};
}
function dateObject(value) { return new Date(`${value}T12:00:00`); }
function signed(value) { return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatMoney(Math.abs(value))}`; }
function plural(count) { const n=count%100;return n>=11&&n<=14?'операций':count%10===1?'операция':count%10>=2&&count%10<=4?'операции':'операций'; }
function toast(message, error=false) {
  $('#toast').textContent=message;$('#toast').classList.toggle('error',Boolean(error));$('#toast').hidden=false;
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('#toast').hidden=true;},error?6500:3800);
}
function applyData(next) {
  if(data&&next.revision<data.revision)return;
  data=next;
  if(ui.accountId&&!account(ui.accountId))ui.accountId=null;
  if(ui.lastAccountId&&!account(ui.lastAccountId))ui.lastAccountId=null;
  render();
  if(ui.entryOpen)renderEntry();
}
function transactionDelta(transaction) {
  if(transaction.type==='transfer')return ui.accountId?(transaction.toAccountId===ui.accountId?transaction.amountCents:-transaction.amountCents):0;
  return transaction.type==='income'?transaction.amountCents:-transaction.amountCents;
}
function render() {
  if(!data)return;
  $('#balance').textContent=formatMoney(totalBalance(data));
  $('#balance').parentElement.classList.toggle('long-balance',$('#balance').textContent.length>14);
  $('#history-scope').textContent=ui.accountId?account(ui.accountId).name:'Все счета';
  $('#account-balances').innerHTML=data.accounts.map(item=>`<button class="balance-account" data-balance-account="${item.id}" aria-pressed="${ui.accountId===item.id}" aria-label="${escape(item.name)}: ${formatMoney(accountBalance(data,item.id))} рублей. Фильтр операций">${icon('wallet')}<span class="balance-account-name">${escape(item.name)}</span><strong class="balance-account-value">${formatMoney(accountBalance(data,item.id))} <small>₽</small></strong><span class="balance-account-check" aria-hidden="true">${icon('check')}</span></button>`).join('');
  $$('#account-balances button').forEach(button=>button.onclick=()=>{const id=button.dataset.balanceAccount;ui.accountId=ui.accountId===id?null:id;render();$$('#account-balances button').find(item=>item.dataset.balanceAccount===id)?.focus({preventScroll:true});});
  $('#expense').innerHTML=`${formatMoney(monthlyTotal(data,{month:ui.month,accountId:ui.accountId,type:'expense'}))} <small>₽</small>`;
  $('#income').innerHTML=`${formatMoney(monthlyTotal(data,{month:ui.month,accountId:ui.accountId,type:'income'}))} <small>₽</small>`;
  const [year,month]=ui.month.split('-').map(Number);
  $('#month-label').textContent=MONTHS[month-1]+(year!==new Date().getFullYear()?` ${year}`:'');
  $('#stats-month-label').textContent=`${MONTHS[month-1]} ${year}`;
  $('#stats-accounts').textContent=ui.accountId?account(ui.accountId).name:'Все счета';
  renderHistory();renderStats();
}
function renderHistory() {
  const transactions=monthlyTransactions(data,{month:ui.month,accountId:ui.accountId}).slice().sort((left,right)=>right.date.localeCompare(left.date)||right.createdAt.localeCompare(left.createdAt)||right.id.localeCompare(left.id));
  if(!transactions.length){
    $('#history').innerHTML=`<div class="empty-state">${icon('list')}<strong>Пока нет операций</strong><p>${data.transactions.length?'В этом месяце и на этом счёте ещё нет записей.':'Добавь первый расход или доход — всё сохранится на этом устройстве.'}</p><button class="empty-add" id="first-operation">Добавить операцию</button></div>`;
    $('#first-operation').onclick=()=>openEntry();return;
  }
  const groups=new Map();for(const transaction of transactions){if(!groups.has(transaction.date))groups.set(transaction.date,[]);groups.get(transaction.date).push(transaction);}
  const today=localToday(),yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);
  $('#history').innerHTML=[...groups].map(([date,items])=>{
    const label=date===today?'Сегодня':date===localToday(yesterday)?'Вчера':longDate.format(dateObject(date));
    const total=items.reduce((sum,item)=>sum+transactionDelta(item),0);
    return `<section class="day-group"><header class="day-header"><h2>${escape(label)}${date===today||date===localToday(yesterday)?`<small>${escape(shortDate.format(dateObject(date)))}</small>`:''}</h2><span class="day-total">${signed(total)} ₽</span></header>${items.map(transactionRow).join('')}</section>`;
  }).join('');
  $$('#history [data-transaction]').forEach(button=>button.onclick=()=>openEntry(button.dataset.transaction));
}
function transactionRow(transaction) {
  const transfer=transaction.type==='transfer';
  const {category,sub}=categoryInfo(transaction.type,transaction.categoryId,transaction.subcategoryId);
  const title=transaction.description||(transfer?'Перевод между счетами':sub?.name||category?.name||'Операция');
  const meta=transfer?`${account(transaction.accountId).name} → ${account(transaction.toAccountId).name}`:`${category.name} · ${sub.name}${ui.accountId?'':` · ${account(transaction.accountId).name}`}`;
  const delta=transactionDelta(transaction);
  const prefix=transfer&&!ui.accountId?'↔ ':delta>0?'+':'−';
  return `<button class="transaction" data-transaction="${transaction.id}" aria-label="${escape(title)}, ${prefix}${formatMoney(transaction.amountCents)} рублей. Изменить">`+
    `<span class="transaction-icon">${icon(transfer?'transfer':category.icon)}</span><span class="transaction-info"><span class="transaction-title">${escape(title)}</span><span class="transaction-meta">${escape(meta)}</span></span><span class="transaction-amount ${delta>0?'positive':''}">${prefix}${formatMoney(transaction.amountCents)}<span class="currency"> ₽</span></span></button>`;
}
function renderStats() {
  const stats=monthlyStats(data,{month:ui.month,accountId:ui.accountId,type:ui.statType});
  $('#stats-total').textContent=formatMoney(stats.total);$('#stats-count').textContent=`${stats.count} ${plural(stats.count)} за месяц`;
  $$('[data-stat-type]').forEach(button=>{const selected=button.dataset.statType===ui.statType;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});
  const max=Math.max(...stats.daily,1);
  $('#daily-chart').innerHTML=stats.daily.map((value,index)=>`<span class="daily-bar ${value?'active':''}" style="height:${value?Math.max(4,value/max*100):2}%" title="${index+1}: ${formatMoney(value)} ₽" aria-hidden="true"></span>`).join('');
  $('#daily-chart').setAttribute('aria-label',`${ui.statType==='expense'?'Расходы':'Доходы'} по дням: ${stats.daily.map((value,index)=>value?`${index+1} число — ${formatMoney(value)} рублей`:'').filter(Boolean).join('; ')||'нет операций'}`);
  const monthShort=shortDate.format(dateObject(`${ui.month}-01`)).replace(/^1\s*/,'');
  $$('.chart-axis span').forEach((span,index)=>span.textContent=`${[1,15,stats.daily.length][index]} ${monthShort}`);
  $('#breakdown').innerHTML=stats.byCategory.length?stats.byCategory.map(category=>{
    const expanded=ui.expanded.has(`${ui.statType}:${category.id}`);
    return `<button class="category-stat" data-category="${category.id}" aria-expanded="${expanded}"><span class="stat-top"><span class="stat-icon">${icon(category.icon)}</span><span class="stat-name">${escape(category.name)}</span><strong class="stat-amount">${formatMoney(category.total)} ₽</strong><span class="stat-share">${Math.round(category.total/stats.total*100)}%</span></span><span class="stat-track"><i style="width:${category.total/stats.total*100}%"></i></span><span class="stat-detail" ${expanded?'':'hidden'}>${category.subs.map(sub=>`<span class="subrow"><span>${escape(sub.name)}</span><strong>${formatMoney(sub.total)} ₽</strong></span>`).join('')}</span></button>`;
  }).join(''):'<div class="empty-state"><strong>Здесь появятся категории</strong><p>Добавь операцию, чтобы увидеть распределение.</p></div>';
  $$('#breakdown [data-category]').forEach(button=>button.onclick=()=>{const key=`${ui.statType}:${button.dataset.category}`;if(ui.expanded.has(key))ui.expanded.delete(key);else ui.expanded.add(key);const expanded=ui.expanded.has(key);button.setAttribute('aria-expanded',String(expanded));button.querySelector('.stat-detail').hidden=!expanded;});
}
function showView(view) {
  ui.view=view;$('#home-view').hidden=view!=='home';$('#stats-view').hidden=view!=='stats';$('#screen-heading').textContent=view==='stats'?'Обзор':'Операции';
  $$('[data-view]').forEach(button=>{const active=button.dataset.view===view;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
}
function modalBackground() {
  $$('.topbar,.view,.bottom-actions,#update-banner').forEach(element=>element.inert=ui.entryOpen||ui.pickerOpen);
  $('#entry').inert=ui.pickerOpen;
}
function openPicker(title,content,trigger=document.activeElement) {
  if(ui.saving)return;
  pickerReturnFocus=trigger;$('#picker-title').textContent=title;$('#picker-content').innerHTML=content;$('#picker-error').hidden=true;
  ui.pickerOpen=true;$('#picker-overlay').hidden=false;modalBackground();$('#close-picker').focus({preventScroll:true});
}
function closePicker(restore=true) {
  if(!ui.pickerOpen||ui.saving)return;
  ui.pickerOpen=false;$('#picker-overlay').hidden=true;modalBackground();
  if(restore)(pickerReturnFocus?.isConnected?pickerReturnFocus:$('#add')).focus({preventScroll:true});
}
function pickerManagement() { closePicker(false);management.open(); }
function openAccounts(mode='filter',trigger=document.activeElement) {
  const selected=mode==='from'?ui.entry.accountId:mode==='to'?ui.entry.toAccountId:ui.accountId;
  const options=mode==='filter'?[{id:null,name:'Все счета'},...data.accounts]:data.accounts;
  openPicker(mode==='from'?'С какого счёта?':mode==='to'?'На какой счёт?':'Счета',options.map(item=>{
    const amount=item.id?accountBalance(data,item.id):totalBalance(data);
    return `<button class="account-option" data-pick-account="${item.id||''}" aria-pressed="${selected===item.id}"><span class="account-option-icon">${icon('wallet')}</span><span class="account-option-copy"><span>${escape(item.name)}</span><strong>${formatMoney(amount)} ₽</strong></span>${icon(selected===item.id?'check':'right')}</button>`;
  }).join('')+'<button class="picker-manage" id="manage-accounts">Управлять счетами</button>',trigger);
  $$('[data-pick-account]').forEach(button=>button.onclick=()=>{
    const id=button.dataset.pickAccount||null;
    if(mode==='filter'){ui.accountId=id;render();}
    else {ui.entry[mode==='from'?'accountId':'toAccountId']=id;renderEntry();}
    closePicker();
  });
  $('#manage-accounts').onclick=pickerManagement;
}
function openCategories(trigger) {
  const entry=ui.entry;
  openPicker('Категория и подкатегория',data.categories[entry.type].map(category=>`<section class="category-group"><h3>${icon(category.icon)}${escape(category.name)}</h3><div class="subcategory-grid">${category.subs.map(sub=>`<button class="subcategory-option" data-pick-category="${category.id}" data-pick-sub="${sub.id}" aria-pressed="${entry.categoryId===category.id&&entry.subcategoryId===sub.id}">${icon(category.icon)}<span>${escape(sub.name)}</span></button>`).join('')}</div></section>`).join('')+'<button class="picker-manage" id="manage-categories">Управлять категориями</button>',trigger);
  $$('[data-pick-sub]').forEach(button=>button.onclick=()=>{entry.categoryId=button.dataset.pickCategory;entry.subcategoryId=button.dataset.pickSub;renderEntry();closePicker();});
  $('#manage-categories').onclick=pickerManagement;
}
function openMonths(trigger) {
  let year=Number(ui.month.slice(0,4));
  openPicker('Месяц','',trigger);
  function fill() {
    $('#picker-content').innerHTML=`<div class="month-year"><button id="previous-year" aria-label="Предыдущий год" ${year<=1?'disabled':''}>${icon('left')}</button><strong>${year}</strong><button id="next-year" aria-label="Следующий год" ${year>=9999?'disabled':''}>${icon('right')}</button></div><div class="months-grid">${MONTHS.map((name,index)=>{const value=`${String(year).padStart(4,'0')}-${String(index+1).padStart(2,'0')}`;return `<button data-pick-month="${value}" aria-pressed="${value===ui.month}">${name}</button>`;}).join('')}</div><button class="picker-manage" id="current-month">Текущий месяц</button>`;
    $('#previous-year').onclick=()=>{year--;fill();$('#previous-year').focus();};$('#next-year').onclick=()=>{year++;fill();$('#next-year').focus();};
    $$('[data-pick-month]').forEach(button=>button.onclick=()=>{ui.month=button.dataset.pickMonth;render();closePicker();});
    $('#current-month').onclick=()=>{ui.month=localToday().slice(0,7);render();closePicker();};
  }
  fill();
}
function openEntry(id=null) {
  if(!data||ui.saving)return;
  const transaction=id?data.transactions.find(item=>item.id===id):null;
  if(id&&!transaction){toast('Эта операция уже удалена.',true);return;}
  entryReturnFocus=document.activeElement;
  const accountId=transaction?.accountId||ui.accountId||ui.lastAccountId||data.accounts[0].id;
  ui.entryOriginal=transaction?JSON.stringify(transaction):null;
  ui.entry=transaction?{...transaction}:{id:null,type:'expense',accountId,toAccountId:data.accounts.find(item=>item.id!==accountId)?.id||null,categoryId:null,subcategoryId:null};
  ui.entryOpen=true;$('#entry').hidden=false;$('#amount').value=transaction?String(Math.floor(transaction.amountCents/100))+(transaction.amountCents%100?','+String(transaction.amountCents%100).padStart(2,'0'):''):'';
  $('#description').value=transaction?.description||'';$('#entry-date').value=transaction?.date||localToday();$('#entry-error').hidden=true;$('#entry-title').textContent=transaction?'Изменить':'Операция';
  $('#entry').scrollTop=0;renderEntry();modalBackground();$('#amount').focus({preventScroll:true});
}
function closeEntry(restore=true) {
  if(ui.saving)return;
  if(ui.pickerOpen)closePicker(false);ui.entryOpen=false;$('#entry').hidden=true;modalBackground();
  if(restore)(entryReturnFocus?.isConnected?entryReturnFocus:$('#add')).focus({preventScroll:true});
}
function renderEntry() {
  if(!ui.entryOpen)return;
  const entry=ui.entry,transfer=entry.type==='transfer';
  $$('[data-type]').forEach(button=>{const selected=button.dataset.type===entry.type;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));button.disabled=ui.saving;});
  $('#amount-sign').textContent=transfer?'↔':entry.type==='income'?'+':'−';
  $('#entry-account-name').textContent=account(entry.accountId)?.name||'Выбрать счёт';
  $('#entry-to-account').hidden=!transfer;$('#entry-to-account-name').textContent=account(entry.toAccountId)?.name||'Выбрать второй счёт';
  $('#entry-category').hidden=transfer;
  const {category,sub}=categoryInfo(entry.type,entry.categoryId,entry.subcategoryId);
  $('#entry-category').classList.toggle('chosen',Boolean(category&&sub));
  $('#entry-category-name').textContent=category&&sub?`${category.name} · ${sub.name}`:'Категория и подкатегория';
  $('#entry-category-icon use').setAttribute('href',`#${category?.icon||'list'}`);
  $('#delete-operation').hidden=!entry.id;$('#save').textContent=ui.saving?'Сохраняю…':entry.id?'Сохранить':'Добавить';
  $('#recent-pairs').hidden=transfer;
  if(!transfer){
    const pairs=[],seen=new Set();
    const consider=(categoryId,subcategoryId)=>{const info=categoryInfo(entry.type,categoryId,subcategoryId),key=categoryId+':'+subcategoryId;if(info.sub&&!seen.has(key)){seen.add(key);pairs.push({category:info.category,sub:info.sub});}};
    data.transactions.filter(item=>item.type===entry.type).slice().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).forEach(item=>consider(item.categoryId,item.subcategoryId));
    data.categories[entry.type].forEach(item=>consider(item.id,item.subs[0].id));
    $('#recent-pairs').innerHTML=pairs.slice(0,3).map(({category,sub})=>`<button class="recent-pair ${entry.categoryId===category.id&&entry.subcategoryId===sub.id?'selected':''}" data-recent-category="${category.id}" data-recent-sub="${sub.id}" title="${escape(category.name+' · '+sub.name)}">${icon(category.icon)}<span>${escape(sub.name)}</span></button>`).join('');
    $$('[data-recent-sub]').forEach(button=>button.onclick=()=>{entry.categoryId=button.dataset.recentCategory;entry.subcategoryId=button.dataset.recentSub;renderEntry();});
  }
  $('#amount').disabled=ui.saving;$('#description').disabled=ui.saving;$('#entry-date').disabled=ui.saving;
  $$('#entry-account,#entry-to-account,#entry-category,#close-entry,#delete-operation,#entry [data-key],#entry [data-recent-sub]').forEach(button=>button.disabled=ui.saving);
  updateAmount();
}
function sanitizeAmount(raw) {
  const parts=raw.replace(/\./g,',').replace(/[^0-9,]/g,'').split(',');
  return (parts[0].slice(0,9).replace(/^0+(?=\d)/,'')||(parts.length>1?'0':''))+(parts.length>1?','+parts.slice(1).join('').slice(0,2):'');
}
function updateAmount() {
  const input=$('#amount');input.value=sanitizeAmount(input.value);
  const length=Math.max(input.value.length,1),size=Math.max(30,Math.min(64,64-Math.max(length-5,0)*5));
  input.style.fontSize=`${size}px`;input.style.width=`${Math.min(240,Math.max(size*.65,length*size*.6))}px`;
  let amount=0;try{amount=parseMoney(input.value);}catch{}
  const entry=ui.entry;if(!entry)return;
  const {category,sub}=categoryInfo(entry.type,entry.categoryId,entry.subcategoryId);
  const validAccount=Boolean(account(entry.accountId));
  const validCategory=entry.type==='transfer'?Boolean(account(entry.toAccountId)&&entry.accountId!==entry.toAccountId):Boolean(category&&sub);
  const date=$('#entry-date').value,parsedDate=new Date(`${date}T12:00:00Z`),validDate=/^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(parsedDate.getTime())&&parsedDate.toISOString().slice(0,10)===date;
  $('#save').disabled=ui.saving||!(amount>0&&validAccount&&validCategory&&validDate);
  $('#entry-hint').textContent=ui.saving?'Сохраняю на устройстве…':amount<=0?'Введи сумму':!validAccount?'Выбери счёт':!validCategory?(entry.type==='transfer'?'Выбери два разных счёта':'Выбери категорию и подкатегорию'):!validDate?'Выбери дату':'';
}
async function saveEntry() {
  updateAmount();if($('#save').disabled)return;
  const entry={...ui.entry,amountCents:parseMoney($('#amount').value),date:$('#entry-date').value,description:$('#description').value.trim()};
  if(entry.type==='transfer'){entry.categoryId=null;entry.subcategoryId=null;}else entry.toAccountId=null;
  const original=ui.entryOriginal;
  const previousMonth=ui.month;ui.saving=true;$('#entry-error').hidden=true;renderEntry();
  try {
    const next=await store.update(draft=>{
      if(entry.id&&JSON.stringify(draft.transactions.find(item=>item.id===entry.id))!==original)throw new Error('Операция изменилась в другой вкладке. Закройте форму и откройте запись снова.');
      saveTransaction(draft,entry);
    });
    ui.saving=false;ui.lastAccountId=entry.accountId;ui.month=entry.date.slice(0,7);if(ui.accountId)ui.accountId=entry.accountId;
    applyData(next);showView('home');closeEntry();toast(entry.id?'Изменения сохранены':'Операция добавлена');
  } catch(error) {ui.saving=false;ui.month=previousMonth;$('#entry-error').textContent=error.message;$('#entry-error').hidden=false;renderEntry();}
}
function confirmDelete() {
  const id=ui.entry?.id,original=ui.entryOriginal;if(!id)return;
  openPicker('Удалить операцию?','<p class="confirmation-copy">Запись будет удалена, а остатки и статистика пересчитаны.</p><button class="danger-action" id="confirm-delete">Удалить операцию</button><button class="picker-manage" id="cancel-delete">Отмена</button>',$('#delete-operation'));
  $('#cancel-delete').onclick=()=>closePicker();
  $('#confirm-delete').onclick=async()=>{
    if(ui.saving)return;ui.saving=true;$('#confirm-delete').disabled=true;
    try {const next=await store.update(draft=>{if(JSON.stringify(draft.transactions.find(item=>item.id===id))!==original)throw new Error('Операция изменилась. Закройте форму и проверьте запись перед удалением.');deleteTransaction(draft,id);});ui.saving=false;applyData(next);closePicker(false);closeEntry();toast('Операция удалена');}
    catch(error){ui.saving=false;$('#picker-error').textContent=error.message;$('#picker-error').hidden=false;$('#confirm-delete').disabled=false;}
  };
}
function trapFocus(event) {
  if(document.querySelector('dialog[open]'))return;
  const modal=ui.pickerOpen?$('#picker'):ui.entryOpen?$('#entry'):null;if(!modal||event.key!=='Tab')return;
  const nodes=[...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(element=>!element.hidden&&element.getClientRects().length>0),first=nodes[0],last=nodes[nodes.length-1];
  if(!first){event.preventDefault();return;}
  if(event.shiftKey&&(document.activeElement===first||!modal.contains(document.activeElement))){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&(document.activeElement===last||!modal.contains(document.activeElement))){event.preventDefault();first.focus();}
}
function bindEvents() {
  $$('[data-view]').forEach(button=>button.onclick=()=>showView(button.dataset.view));
  $$('[data-stat-type]').forEach(button=>button.onclick=()=>{ui.statType=button.dataset.statType;renderStats();});
  $$('[data-month-picker]').forEach(button=>button.onclick=()=>openMonths(button));
  $('#open-accounts').onclick=event=>openAccounts('filter',event.currentTarget);$('#stats-accounts').onclick=event=>openAccounts('filter',event.currentTarget);
  $('#entry-account').onclick=event=>openAccounts('from',event.currentTarget);$('#entry-to-account').onclick=event=>openAccounts('to',event.currentTarget);$('#entry-category').onclick=event=>openCategories(event.currentTarget);
  $('#add').onclick=()=>openEntry();$('#close-entry').onclick=()=>closeEntry();$('#close-picker').onclick=()=>closePicker();
  $('#picker-overlay').onclick=event=>{if(event.target===event.currentTarget)closePicker();};
  $('#settings-toggle').onclick=()=>management.open();$('#amount').oninput=updateAmount;$('#entry-date').oninput=updateAmount;$('#save').onclick=saveEntry;$('#delete-operation').onclick=confirmDelete;
  $$('[data-type]').forEach(button=>button.onclick=()=>{ui.entry.type=button.dataset.type;ui.entry.categoryId=null;ui.entry.subcategoryId=null;if(ui.entry.type==='transfer'&&(!ui.entry.toAccountId||ui.entry.toAccountId===ui.entry.accountId))ui.entry.toAccountId=data.accounts.find(item=>item.id!==ui.entry.accountId)?.id||null;renderEntry();});
  $$('[data-key]').forEach(button=>button.onclick=()=>{const input=$('#amount'),key=button.dataset.key;if(key==='back')input.value=input.value.slice(0,-1);else if(key===','){if(!input.value.includes(','))input.value=`${input.value||'0'},`;}else input.value+=key;updateAmount();});
  document.addEventListener('keydown',event=>{
    if(document.querySelector('dialog[open]'))return;
    if(event.key==='Escape'){if(ui.pickerOpen){event.preventDefault();closePicker();}else if(ui.entryOpen){event.preventDefault();closeEntry();}}
    trapFocus(event);
  });
  window.addEventListener('chesno:storage-error',event=>toast(event.detail?.message||'Не удалось обновить локальные данные.',true));
}
async function boot() {
  try {
    store=await openStore();data=await store.read();
    management=createManagement({store,getData:()=>data,onChange:applyData,notify:toast});
    bindEvents();store.subscribe(applyData);render();
    $('#boot-status').hidden=true;$('#app').classList.remove('is-loading');$('#app').setAttribute('aria-busy','false');
    void initPWA({notify:management.notify,canUpdate:()=>!ui.entryOpen&&!ui.pickerOpen&&!ui.saving&&!management.isOpen()&&!management.isBusy()});
  } catch(error) {
    $('#boot-message').textContent=error.message||'Не удалось открыть локальное хранилище. Перезапустите приложение.';$('#retry-boot').hidden=false;$('#app').setAttribute('aria-busy','false');
    $('#retry-boot').onclick=()=>location.reload();
  }
}
void boot();
