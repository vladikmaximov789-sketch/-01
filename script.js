// настройки
var AVATAR_BOT   = 'assets/bot.png';            
var AVATAR_USER  = 'assets/user.png';           
var ICON_ACTIVE   = 'assets/send-active.png';   
var ICON_INACTIVE = 'assets/send-inactive.png'; 

// элементы 
var messages = document.getElementById('messages');
var input    = document.getElementById('input');
var sendBtn  = document.getElementById('sendBtn');
var sendIcon = document.getElementById('sendIcon');

// Состояние бота
var state = 'idle'; // idle -> name -> ready <-> action
var userName = '';
var pendingNumbers = null;
var vars = { ans: null }; // ans — последний результат
var cmdHistory = [];
var historyIndex = -1;
var feed = []; // [{type:'user'|'bot', el}]

function makeRow(who) {
  var row = document.createElement('div');
  row.className = 'message-row ' + who;
  var avatar = document.createElement('img');
  avatar.className = 'avatar';
  avatar.src = who === 'bot' ? AVATAR_BOT : AVATAR_USER;
  avatar.alt = who === 'bot' ? 'Чат-бот' : 'Пользователь';
  row.appendChild(avatar);
  return row;
}

// Новые сообщения сверху
function addUserMessage(text) {
  var row = makeRow('user');
  var bubble = document.createElement('div');
  bubble.className = 'bubble user';
  bubble.textContent = text;
  row.appendChild(bubble);
  messages.insertBefore(row, messages.firstChild);
  feed.push({ type: 'user', el: row });
  messages.scrollTop = 0;
}

function addBotMessage(text) {
  var row = makeRow('bot');
  var bubble = document.createElement('div');
  bubble.className = 'bubble bot';
  bubble.textContent = text;
  row.appendChild(bubble);
  messages.insertBefore(row, messages.firstChild);
  feed.push({ type: 'bot', el: row });
  messages.scrollTop = 0;
}

// Анимация троеточия 
function showTyping(callback) {
  var row = makeRow('bot');
  var bubble = document.createElement('div');
  bubble.className = 'bubble bot';
  var dots = document.createElement('div');
  dots.className = 'typing-dots';
  dots.innerHTML = '<span></span><span></span><span></span>';
  bubble.appendChild(dots);
  row.appendChild(bubble);
  messages.insertBefore(row, messages.firstChild);
  messages.scrollTop = 0;
  setTimeout(function () {
    row.remove();
    callback();
  }, 800);
}

// /undo
function undoLastPair() {
  for (var i = feed.length - 1; i >= 0; i--) {
    if (feed[i].type === 'bot') { feed[i].el.remove(); feed.splice(i, 1); break; }
  }
  for (var j = feed.length - 1; j >= 0; j--) {
    if (feed[j].type === 'user') { feed[j].el.remove(); feed.splice(j, 1); break; }
  }
}

// парсер чисел
function resolveToken(token) {
  if (/^-?\d+$/.test(token)) return parseInt(token, 10);
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(token)) {
    if (Object.prototype.hasOwnProperty.call(vars, token) && vars[token] !== null) return vars[token];
    throw new Error('Вводите только целые числа');
  }
  throw new Error('Вводите только целые числа');
}

// Некие форматы 
function parseNumbers(raw) {
  var tokens = raw.trim().split(/[\s,;]+/).filter(function (t) { return t.length > 0; });
  if (!tokens.length) throw new Error('Неверный формат ввода');
  var numbers = [];
  for (var i = 0; i < tokens.length; i++) {
    var m = tokens[i].match(/^(-?\d+)\.{2,3}(-?\d+)$/);
    if (m) {
      var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (b < a) throw new Error('Неверный формат ввода');
      if (b - a > 100000) throw new Error('Неверный формат ввода');
      for (var n = a; n <= b; n++) numbers.push(n);
    } else {
      numbers.push(resolveToken(tokens[i]));
    }
  }
  if (!numbers.length) throw new Error('Неверный формат ввода');
  return numbers;
}

// мат. функц.
function gcdPair(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { var t = a % b; a = b; b = t; }
  return a;
}

function computeResult(op, nums) {
  if (op === '+') return nums.reduce(function (a, b) { return a + b; }, 0);
  if (op === '-') return nums.reduce(function (a, b) { return a - b; });
  if (op === '*') return nums.reduce(function (a, b) { return a * b; }, 1);
  if (op === '/') {
    if (nums.slice(1).some(function (x) { return x === 0; })) {
      throw new Error('Деление на ноль невозможно');
    }
    return nums.reduce(function (a, b) { return a / b; });
  }
  if (op === 'min') return Math.min.apply(null, nums);
  if (op === 'max') return Math.max.apply(null, nums);
  if (op === 'avg') return nums.reduce(function (a, b) { return a + b; }, 0) / nums.length;
  if (op === 'gcd') return nums.reduce(gcdPair);
  throw new Error('Я не понимаю, введите другую команду!');
}

// Форматирование 
function fmt(x) {
  if (Number.isInteger(x)) return String(x);
  return String(Number(x.toPrecision(3)));
}

// логика бота
var OPS = ['+', '-', '*', '/', 'gcd', 'avg', 'min', 'max'];
var NUMBERS_PROMPT = 'Числа приняты. Введи действие: +, -, *, /, gcd, avg, min, max';
var DONT_UNDERSTAND = 'Я не понимаю, введите другую команду!';

function looksLikeNumbers(text) {
  if (/^\/\S+/i.test(text)) return false; // это команда
  return /[\d]/.test(text) || /^[a-zA-Z0-9_,;.\s\-]+$/.test(text);
}

function respond(raw) {
  var text = raw.trim();

  if (/^\/start$/i.test(text)) {
    state = 'name';
    return 'Привет, меня зовут Чат-бот, а как зовут тебя?';
  }
  if (/^\/stop$/i.test(text)) {
    state = 'idle';
    pendingNumbers = null;
    return 'Всего доброго, если хочешь поговорить пиши /start';
  }

  var m = text.match(/^\/name\s*:\s*(.+)$/i);
  if (m) {
    if (state === 'idle') return 'Введите команду /start, для начала общения';
    userName = m[1].trim();
    state = 'ready';
    return 'Привет ' + userName + ', приятно познакомится. Я умею считать, введи числа которые надо посчитать';
  }

  m = text.match(/^\/set\s*:\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(-?\d+)$/i);
  if (m) {
    if (state === 'idle') return 'Введите команду /start, для начала общения';
    vars[m[1]] = parseInt(m[2], 10);
    return 'Переменная ' + m[1] + ' = ' + m[2] + ' сохранена';
  }

  m = text.match(/^\/numbers\s*:\s*(.+)$/i);
  if (m) {
    if (state === 'idle') return 'Введите команду /start, для начала общения';
    try {
      pendingNumbers = parseNumbers(m[1]);
    } catch (e) {
      return e.message;
    }
    state = 'action';
    return NUMBERS_PROMPT;
  }

  if (state === 'idle') return 'Введите команду /start, для начала общения';

  // Ожидание имени
  if (state === 'name') {
    userName = text;
    state = 'ready';
    return 'Привет ' + userName + ', приятно познакомится. Я умею считать, введи числа которые надо посчитать';
  }

  // Ожидание операции
  if (state === 'action') {
    var op = text.toLowerCase();
    if (OPS.indexOf(op) !== -1) {
      try {
        var value = computeResult(op, pendingNumbers);
        vars.ans = value;
        state = 'ready';
        return 'Результат: ' + fmt(value);
      } catch (e) {
        return e.message;
      }
    }
    return DONT_UNDERSTAND;
  }

  if (looksLikeNumbers(text)) {
    try {
      pendingNumbers = parseNumbers(text);
    } catch (e) {
      return e.message;
    }
    state = 'action';
    return NUMBERS_PROMPT;
  }
  return DONT_UNDERSTAND;
}

//  Отправка 
function send() {
  var text = input.value.trim();
  if (!text) return;

  input.value = '';
  updateSendState();

  cmdHistory.push(text);
  historyIndex = -1;

  if (/^\/undo$/i.test(text)) {
    undoLastPair();
    return;
  }

  addUserMessage(text);

  var reply = respond(text);
  if (reply !== null) {
    showTyping(function () { addBotMessage(reply); });
  }
}

function updateSendState() {
  var hasText = input.value.trim().length > 0;
  sendBtn.disabled = !hasText;
  sendIcon.src = hasText ? ICON_ACTIVE : ICON_INACTIVE;
}

sendBtn.addEventListener('click', send);

input.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { send(); return; }
  if (e.key === 'ArrowUp') {
    if (!cmdHistory.length) return;
    historyIndex = historyIndex === -1 ? cmdHistory.length - 1 : Math.max(0, historyIndex - 1);
    input.value = cmdHistory[historyIndex];
    updateSendState();
    e.preventDefault();
  } else if (e.key === 'ArrowDown') {
    if (historyIndex === -1) return;
    historyIndex++;
    if (historyIndex >= cmdHistory.length) { historyIndex = -1; input.value = ''; }
    else { input.value = cmdHistory[historyIndex]; }
    updateSendState();
    e.preventDefault();
  }
});

input.addEventListener('input', updateSendState);
updateSendState();
