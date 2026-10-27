/* Interactive design study: demo data stays in memory until page reload. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const icon = name => `<svg aria-hidden="true"><use href="#${name}"/></svg>`;
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const TODAY = '2026-10-27';
  const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const shortDate = new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',timeZone:'UTC'});
  const longDate = new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',timeZone:'UTC'});
  const money = cents => new Intl.NumberFormat('ru-RU',{minimumFractionDigits:cents % 100 === 0 ? 0 : 2,maximumFractionDigits:2}).format(cents/100);
  const signedMoney = cents => `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${money(Math.abs(cents))}`;
  const dateObject = date => new Date(`${date}T12:00:00Z`);
  const accounts = [
    {id:'main',name:'Основной',opening:809000,description:'На каждый день'},
    {id:'savings',name:'Накопления',opening:5000000,description:'На то, что важно'},
    {id:'cash',name:'Наличные',opening:410000,description:'Всегда под рукой'}
  ];
  const categories = {
    expense:[
      {id:'food',name:'Еда',icon:'food',subs:[{id:'groceries',name:'Продукты'},{id:'coffee',name:'Кофе',icon:'coffee'},{id:'restaurants',name:'Рестораны'}]},
      {id:'transport',name:'Транспорт',icon:'travel',subs:[{id:'taxi',name:'Такси'},{id:'metro',name:'Метро'},{id:'car',name:'Авто'}]},
      {id:'shopping',name:'Покупки',icon:'wallet',subs:[{id:'clothes',name:'Одежда'},{id:'home',name:'Для дома'},{id:'tech',name:'Техника'}]}
    ],
    income:[
      {id:'work',name:'Работа',icon:'work',subs:[{id:'salary',name:'Зарплата'},{id:'freelance',name:'Фриланс'},{id:'bonus',name:'Премия'}]},
      {id:'other',name:'Другое',icon:'wallet',subs:[{id:'gift',name:'Подарки'},{id:'refund',name:'Возврат'},{id:'interest',name:'Проценты'}]}
    ]
  };
  let nextId = 1;
  function seed(date,title,rubles,categoryId,subId,accountId='main',type='expense',note='') {
    return {id:nextId++,date,title,cents:rubles*100,categoryId,subId,accountId,type,note};
  }
  const transactions = [
    seed(TODAY,'ВкусВилл',2450,'food','groceries'),
    seed(TODAY,'Кофе по пути',290,'food','coffee'),
    seed(TODAY,'Яндекс Go',250,'transport','taxi'),
    seed('2026-10-26','Зарплата',95000,'work','salary','main','income'),
    seed('2026-10-26','Обед с друзьями',680,'food','restaurants'),
    seed('2026-10-24','Продукты на неделю',4320,'food','groceries'),
    seed('2026-10-23','Такси за неделю',4272,'transport','taxi'),
    seed('2026-10-22','Кофейни',1570,'food','coffee'),
    seed('2026-10-21','Новая рубашка',3500,'shopping','clothes'),
    seed('2026-10-19','Рынок',2240,'food','groceries','cash'),
    seed('2026-10-17','Ужин в городе',2320,'food','restaurants'),
    seed('2026-10-15','Поездка домой',1260,'transport','taxi','cash'),
    seed('2026-10-12','Тройка',2100,'transport','metro'),
    seed('2026-10-10','Мелочи для дома',2248,'shopping','home'),
    seed('2026-10-08','Кофе с собой',500,'food','coffee','cash'),
    seed('2026-10-05','В аэропорт',740,'transport','taxi')
  ];
  const state = {view:'home',account:null,month:'2026-10',query:'',statType:'expense',entryOpen:false,pickerOpen:false,entry:{type:'expense',account:'main',category:null,sub:null},expanded:new Set()};
  let entryReturnFocus, pickerReturnFocus, toastTimer;
  const account = id => accounts.find(item=>item.id===id);
  function categoryInfo(type,id,subId) {const category=categories[type].find(item=>item.id===id);return {category,sub:category?.subs.find(item=>item.id===subId)};}
  function balance(id) {return account(id).opening + transactions.reduce((sum,t)=>sum+(t.accountId===id?(t.type==='income'?t.cents:-t.cents):0),0);}
  function monthlyTransactions() {return transactions.filter(t=>t.date.startsWith(state.month)&&(!state.account||t.accountId===state.account));}
  function monthlyTotal(type) {return monthlyTransactions().filter(t=>t.type===type).reduce((sum,t)=>sum+t.cents,0);}
  function monthParts() {const [year,month]=state.month.split('-').map(Number);return {year,month,name:MONTHS[month-1]};}
  function operationWord(count) {const last=count%10,two=count%100;if(last===1&&two!==11)return 'операция';if(last>=2&&last<=4&&(two<12||two>14))return 'операции';return 'операций';}
  function render() {
    const {name,year}=monthParts();
    $('#balance').textContent=money(accounts.reduce((sum,a)=>sum+balance(a.id),0));
    $('#history-scope').textContent=state.account?account(state.account).name:'Все счета';
    $('#account-balances').innerHTML=accounts.map(a=>`<button class="balance-account" data-balance-account="${a.id}" aria-pressed="${state.account===a.id}" aria-label="${escape(a.name)}: ${money(balance(a.id))} рублей. Фильтр операций">${icon('wallet')}<span class="balance-account-name">${escape(a.name)}</span><strong class="balance-account-value">${money(balance(a.id))} <small>₽</small></strong><span class="balance-account-check" aria-hidden="true">${icon('check')}</span></button>`).join('');
    $$('#account-balances button').forEach(b=>b.onclick=()=>{const id=b.dataset.balanceAccount;state.account=state.account===id?null:id;render();$$('#account-balances button').find(row=>row.dataset.balanceAccount===id)?.focus({preventScroll:true});});
    $('#expense').innerHTML=`${money(monthlyTotal('expense'))} <small>₽</small>`;
    $('#income').innerHTML=`${money(monthlyTotal('income'))} <small>₽</small>`;
    $('#month-label').textContent=name;$('#stats-month-label').textContent=`${name} ${year}`;
    $('#stats-accounts').textContent=state.account?account(state.account).name:'Все счета';
    renderHistory();renderStats();
  }
  function renderHistory() {
    const query=state.query.trim().toLocaleLowerCase('ru-RU');
    const filtered=monthlyTransactions().filter(t=>{if(!query)return true;const {category,sub}=categoryInfo(t.type,t.categoryId,t.subId);return [t.title,t.note,category.name,sub.name,account(t.accountId).name,money(t.cents)].join(' ').toLocaleLowerCase('ru-RU').includes(query);}).sort((a,b)=>b.date.localeCompare(a.date));
    if(!filtered.length){$('#history').innerHTML=`<div class="empty-state">${icon(query?'search':'list')}<strong>${query?'Ничего не найдено':'Пока тихо'}</strong><p>${query?'Попробуй другое название или категорию.':'В этом месяце ещё нет операций.'}</p></div>`;return;}
    const groups=new Map();for(const t of filtered){if(!groups.has(t.date))groups.set(t.date,[]);groups.get(t.date).push(t);}
    $('#history').innerHTML=[...groups].map(([date,items])=>{
      const total=items.reduce((sum,t)=>sum+(t.type==='income'?t.cents:-t.cents),0);
      const relative=date===TODAY?'Сегодня':date==='2026-10-26'?'Вчера':'';
      const label=relative?`${relative}<small>${shortDate.format(dateObject(date)).replace('.','')}</small>`:escape(longDate.format(dateObject(date)));
      return `<section class="day-group"><header class="day-header"><h2>${label}</h2><span class="day-total">${signedMoney(total)} ₽</span></header>${items.map(transactionRow).join('')}</section>`;
    }).join('');
  }
  function transactionRow(t) {
    const {category,sub}=categoryInfo(t.type,t.categoryId,t.subId);
    const meta=`${category.name} · ${sub.name}${state.account?'':` · ${account(t.accountId).name}`}`;
    return `<article class="transaction"><div class="transaction-icon">${icon(sub.icon||category.icon)}</div><div class="transaction-info"><div class="transaction-title">${escape(t.title)}</div><div class="transaction-meta">${escape(meta)}</div></div><div class="transaction-amount ${t.type==='income'?'positive':''}">${t.type==='income'?'+':'−'}${money(t.cents)}<span class="currency"> ₽</span></div></article>`;
  }
  function renderStats() {
    const items=monthlyTransactions().filter(t=>t.type===state.statType),total=items.reduce((sum,t)=>sum+t.cents,0);
    $('#stats-total').textContent=money(total);$('#stats-count').textContent=`${items.length} ${operationWord(items.length)} за месяц`;
    $$('[data-stat-type]').forEach(b=>{b.classList.toggle('active',b.dataset.statType===state.statType);b.setAttribute('aria-pressed',String(b.dataset.statType===state.statType));});
    const {year,month}=monthParts(),days=new Date(Date.UTC(year,month,0)).getUTCDate(),daily=Array(days).fill(0);
    items.forEach(t=>{daily[Number(t.date.slice(-2))-1]+=t.cents;});const max=Math.max(...daily,1);
    $('#daily-chart').innerHTML=daily.map((value,i)=>`<span class="daily-bar ${value?'active':''}" style="height:${value?Math.max(4,value/max*100):2}%" title="${i+1}: ${money(value)} ₽" aria-hidden="true"></span>`).join('');
    $('#daily-chart').setAttribute('aria-label',`${state.statType==='expense'?'Расходы':'Доходы'} по дням: ${daily.map((value,i)=>value?`${i+1} число — ${money(value)} рублей`:'').filter(Boolean).join('; ')||'нет операций'}`);
    const monthShort=shortDate.format(new Date(Date.UTC(year,month-1,1))).replace(/^1\s*/,'').replace('.','');
    $$('.chart-axis span').forEach((span,i)=>{span.textContent=`${[1,15,days][i]} ${monthShort}`;});
    const groups=categories[state.statType].map(category=>{const group=items.filter(t=>t.categoryId===category.id);return {category,items:group,total:group.reduce((sum,t)=>sum+t.cents,0)};}).filter(g=>g.total>0).sort((a,b)=>b.total-a.total);
    if(!groups.length){$('#breakdown').innerHTML=`<div class="empty-state">${icon('chart')}<strong>Здесь появятся категории</strong><p>Добавь ${state.statType==='expense'?'расход':'доход'}, чтобы увидеть распределение.</p></div>`;return;}
    $('#breakdown').innerHTML=groups.map(({category,items:group,total:categoryTotal})=>{
      const key=`${state.statType}:${category.id}`,expanded=state.expanded.has(key);
      const subrows=category.subs.map(sub=>{const subTotal=group.filter(t=>t.subId===sub.id).reduce((sum,t)=>sum+t.cents,0);return subTotal?`<span class="subrow"><span>${sub.name}</span><strong>${money(subTotal)} ₽</strong></span>`:'';}).join('');
      return `<button class="category-stat" data-category="${category.id}" aria-expanded="${expanded}"><span class="stat-top"><span class="stat-icon">${icon(category.icon)}</span><span class="stat-name">${category.name}</span><strong class="stat-amount">${money(categoryTotal)} ₽</strong><span class="stat-share">${Math.round(categoryTotal/total*100)}%</span></span><span class="stat-track"><i style="width:${categoryTotal/total*100}%"></i></span><span class="stat-detail" ${expanded?'':'hidden'}>${subrows}</span></button>`;
    }).join('');
    $$('#breakdown .category-stat').forEach(b=>b.onclick=()=>{const key=`${state.statType}:${b.dataset.category}`,expanded=!state.expanded.has(key);if(expanded)state.expanded.add(key);else state.expanded.delete(key);b.setAttribute('aria-expanded',String(expanded));b.querySelector('.stat-detail').hidden=!expanded;});
  }
  function showView(view) {state.view=view;$('#home-view').hidden=view!=='home';$('#stats-view').hidden=view!=='stats';$('#screen-heading').textContent=view==='stats'?'Обзор':'Операции';$$('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});}
  function updateModalBackground() {const blocked=state.entryOpen||state.pickerOpen;$$('.topbar,.view,.bottom-actions').forEach(el=>{el.inert=blocked;});$('#entry').inert=state.pickerOpen;}
  function openPicker(title,content,trigger) {pickerReturnFocus=trigger||document.activeElement;$('#picker-title').textContent=title;$('#picker-content').innerHTML=content;state.pickerOpen=true;$('#picker-overlay').hidden=false;updateModalBackground();$('#close-picker').focus({preventScroll:true});}
  function closePicker(restore=true) {if(!state.pickerOpen)return;state.pickerOpen=false;$('#picker-overlay').hidden=true;updateModalBackground();if(restore&&pickerReturnFocus?.isConnected)pickerReturnFocus.focus({preventScroll:true});}
  function openAccounts(entryMode=false,trigger) {
    const selected=entryMode?state.entry.account:state.account,options=entryMode?accounts:[{id:null,name:'Все счета',description:'Общий остаток'},...accounts];
    openPicker(entryMode?'С какого счёта?':'Счета',options.map(a=>{const amount=a.id?balance(a.id):accounts.reduce((sum,item)=>sum+balance(item.id),0);return `<button class="account-option ${selected===a.id?'active':''}" data-pick-account="${a.id||''}" aria-pressed="${selected===a.id}"><span class="account-option-icon">${icon('wallet')}</span><span class="account-option-copy"><span>${a.name}</span><small>${a.description}</small><strong>${money(amount)} ₽</strong></span>${selected===a.id?icon('check'):icon('right')}</button>`;}).join(''),trigger);
    $$('[data-pick-account]').forEach(b=>b.onclick=()=>{const id=b.dataset.pickAccount||null;if(entryMode){state.entry.account=id;renderEntry();}else{state.account=id;render();}closePicker();});
  }
  function openMonths(trigger) {
    openPicker('Месяц',['2026-09','2026-10','2026-11'].map(value=>{const [year,month]=value.split('-').map(Number),count=transactions.filter(t=>t.date.startsWith(value)&&(!state.account||t.accountId===state.account)).length;return `<button class="account-option ${state.month===value?'active':''}" data-pick-month="${value}" aria-pressed="${state.month===value}"><span class="account-option-icon">${icon('calendar')}</span><span class="account-option-copy"><span>${MONTHS[month-1]} ${year}</span><small>${count?`${count} ${operationWord(count)}`:'Пока нет операций'}</small></span>${state.month===value?icon('check'):icon('right')}</button>`;}).join(''),trigger);
    $$('[data-pick-month]').forEach(b=>b.onclick=()=>{state.month=b.dataset.pickMonth;render();closePicker();});
  }
  function openCategories(trigger) {
    openPicker('Категория и подкатегория',categories[state.entry.type].map(category=>`<section class="category-group"><h3>${icon(category.icon)}${category.name}</h3><div class="subcategory-grid">${category.subs.map(sub=>`<button class="subcategory-option ${state.entry.category===category.id&&state.entry.sub===sub.id?'active':''}" data-pick-category="${category.id}" data-pick-sub="${sub.id}" aria-pressed="${state.entry.category===category.id&&state.entry.sub===sub.id}">${icon(sub.icon||category.icon)}<span>${sub.name}</span></button>`).join('')}</div></section>`).join(''),trigger);
    $$('[data-pick-sub]').forEach(b=>b.onclick=()=>{state.entry.category=b.dataset.pickCategory;state.entry.sub=b.dataset.pickSub;renderEntry();closePicker();});
  }
  function openEntry() {if(state.entryOpen)return;entryReturnFocus=document.activeElement;state.entryOpen=true;state.entry.type='expense';state.entry.account=state.account||state.entry.account;state.entry.category=null;state.entry.sub=null;$('#amount').value='';$('#description').value='';$('#entry').hidden=false;renderEntry();updateModalBackground();$('#amount').focus({preventScroll:true});}
  function closeEntry(restore=true) {if(!state.entryOpen)return;if(state.pickerOpen)closePicker(false);state.entryOpen=false;$('#entry').hidden=true;updateModalBackground();if(restore&&entryReturnFocus?.isConnected)entryReturnFocus.focus({preventScroll:true});}
  function renderEntry() {
    $$('[data-type]').forEach(b=>{const selected=b.dataset.type===state.entry.type;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});
    $('#amount-sign').textContent=state.entry.type==='expense'?'−':'+';$('#entry-account-name').textContent=account(state.entry.account).name;
    const {category,sub}=categoryInfo(state.entry.type,state.entry.category,state.entry.sub);
    $('#entry-category').classList.toggle('chosen',Boolean(category&&sub));
    $('#entry-category-name').innerHTML=category&&sub?`${category.name} <span>· ${sub.name}</span>`:'Категория и подкатегория';
    $('#entry-category-icon use').setAttribute('href',`#${sub?.icon||category?.icon||'list'}`);
    $('#entry-category').setAttribute('aria-label',category&&sub?`Категория: ${category.name}, ${sub.name}. Изменить`:'Выбрать обязательные категорию и подкатегорию');
    const recent=state.entry.type==='expense'?[['food','groceries'],['food','coffee'],['transport','taxi']]:[['work','salary'],['work','freelance'],['other','gift']];
    $('#recent-pairs').innerHTML=recent.map(([catId,subId])=>{const info=categoryInfo(state.entry.type,catId,subId),selected=state.entry.category===catId&&state.entry.sub===subId;return `<button class="recent-pair ${selected?'selected':''}" data-recent-category="${catId}" data-recent-sub="${subId}" aria-pressed="${selected}" title="${info.category.name} · ${info.sub.name}">${icon(info.sub.icon||info.category.icon)}<span>${info.sub.name}</span></button>`;}).join('');
    $$('[data-recent-sub]').forEach(b=>b.onclick=()=>{state.entry.category=b.dataset.recentCategory;state.entry.sub=b.dataset.recentSub;renderEntry();});updateAmount();
  }
  function sanitizeAmount(raw) {const parts=raw.replace(/\./g,',').replace(/[^0-9,]/g,'').split(','),integer=parts[0].slice(0,9).replace(/^0+(?=\d)/,'');return (integer||(parts.length>1?'0':''))+(parts.length>1?`,${parts.slice(1).join('').slice(0,2)}`:'');}
  function parseAmount(value) {if(!/^\d{1,9}(?:,\d{0,2})?$/.test(value))return 0;const [whole,fraction='']=value.split(',');return Number(whole)*100+Number(fraction.padEnd(2,'0'));}
  function updateAmount() {
    const input=$('#amount');input.value=sanitizeAmount(input.value);
    const length=Math.max(input.value.length,1),fontSize=Math.max(32,Math.min(64,64-Math.max(length-5,0)*5));
    input.style.fontSize=`${fontSize}px`;input.style.width=`${Math.min(240,Math.max(fontSize*0.65,length*fontSize*0.6))}px`;
    const amount=parseAmount(input.value),{category,sub}=categoryInfo(state.entry.type,state.entry.category,state.entry.sub),valid=Boolean(category&&sub);
    $('#save').disabled=!(amount>0&&valid);$('#entry-hint').textContent=amount<=0?(valid?'Введи сумму':'Введи сумму и выбери категорию'):(valid?'Готово к добавлению':'Выбери категорию и подкатегорию');
  }
  function saveEntry() {
    updateAmount();if($('#save').disabled)return;
    const {category,sub}=categoryInfo(state.entry.type,state.entry.category,state.entry.sub),description=$('#description').value.trim();
    transactions.unshift({id:nextId++,date:TODAY,type:state.entry.type,cents:parseAmount($('#amount').value),accountId:state.entry.account,categoryId:category.id,subId:sub.id,title:description||sub.name,note:description});
    state.month=TODAY.slice(0,7);if(state.account)state.account=state.entry.account;state.query='';$('#search-input').value='';$('#search-field').hidden=true;$('#search-toggle').setAttribute('aria-expanded','false');
    render();showView('home');closeEntry();$('#toast').textContent='Добавлено в эскиз · до перезагрузки';$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,2500);
  }
  function setSearch(open) {showView('home');$('#search-field').hidden=!open;$('#search-toggle').setAttribute('aria-expanded',String(open));if(open)$('#search-input').focus({preventScroll:true});else{state.query='';$('#search-input').value='';renderHistory();$('#search-toggle').focus({preventScroll:true});}}
  function trapFocus(event) {
    const modal=state.pickerOpen?$('#picker'):state.entryOpen?$('#entry'):null;if(!modal||event.key!=='Tab')return;
    const nodes=[...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(el=>!el.hidden&&el.getClientRects().length>0),first=nodes[0],last=nodes[nodes.length-1];
    if(!first){event.preventDefault();return;}
    if(event.shiftKey&&(document.activeElement===first||!modal.contains(document.activeElement))){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(document.activeElement===last||!modal.contains(document.activeElement))){event.preventDefault();first.focus();}
  }
  $$('[data-view]').forEach(b=>b.onclick=()=>showView(b.dataset.view));
  $$('[data-stat-type]').forEach(b=>b.onclick=()=>{state.statType=b.dataset.statType;renderStats();});
  $$('[data-month-picker]').forEach(b=>b.onclick=()=>openMonths(b));
  $('#open-accounts').onclick=e=>openAccounts(false,e.currentTarget);$('#stats-accounts').onclick=e=>openAccounts(false,e.currentTarget);
  $('#entry-account').onclick=e=>openAccounts(true,e.currentTarget);$('#entry-category').onclick=e=>openCategories(e.currentTarget);
  $('#add').onclick=openEntry;$('#close-entry').onclick=()=>closeEntry();$('#close-picker').onclick=()=>closePicker();
  $('#picker-overlay').onclick=e=>{if(e.target===e.currentTarget)closePicker();};$('#search-toggle').onclick=()=>setSearch($('#search-field').hidden);
  $('#search-input').oninput=e=>{state.query=e.target.value;renderHistory();};$('#amount').oninput=updateAmount;$('#save').onclick=saveEntry;
  $$('[data-type]').forEach(b=>b.onclick=()=>{state.entry.type=b.dataset.type;state.entry.category=null;state.entry.sub=null;renderEntry();});
  $$('[data-key]').forEach(b=>b.onclick=()=>{const input=$('#amount'),key=b.dataset.key;if(key==='back')input.value=input.value.slice(0,-1);else if(key===','){if(!input.value.includes(','))input.value=`${input.value||'0'},`;}else input.value+=key;updateAmount();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(state.pickerOpen){e.preventDefault();closePicker();}else if(state.entryOpen){e.preventDefault();closeEntry();}else if(!$('#search-field').hidden){e.preventDefault();setSearch(false);}}trapFocus(e);});
  render();const screen=new URLSearchParams(location.search).get('screen');if(screen==='stats')showView('stats');else if(screen==='entry')openEntry();else if(screen==='accounts')openAccounts(false,$('#open-accounts'));
})();
