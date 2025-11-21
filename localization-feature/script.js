class LocalizationSystem {
    constructor() {
        this.currentLang = 'en';
        this.translations = {
            en: {
                greeting: 'hey!',
                bye: 'bye!',
                kill_message: '{subject} killed by a {object}',
                item_count: 'I have {quantity} {item}',
                item_count_single: 'I have a {item}',
                hero_action: 'The Hero gets {items}.',
                male_pronoun: 'He',
                female_pronoun: 'She',
                neutral_pronoun: 'They',
                male_possessive: 'His',
                female_possessive: 'Her',
                neutral_possessive: 'Their',
                male_action: '{name} is strong. He fights bravely.',
                female_action: '{name} is strong. She fights bravely.',
                neutral_action: '{name} is strong. They fight bravely.',
                game_over: 'Game Over!',
                victory: 'Victory!',
                level_up: 'Level Up! You are now level {level}.',
                health_low: 'Warning: Health is low!',
                mana_full: 'Mana is full!',
                inventory_full: 'Inventory is full!',
                quest_complete: 'Quest Complete: {quest_name}',
                enemy_defeated: '{enemy} defeated! +{exp} experience',
                item_found: 'Found {item}!',
                skill_learned: 'Learned new skill: {skill_name}',
                player_joined: '{player_name} joined the game',
                player_left: '{player_name} left the game',
                chat_message: '[{player}]: {message}',
                system_notification: 'System: {notification}'
            },
            th: {
                greeting: 'หวัดดี!',
                bye: 'บ้ายบาย',
                kill_message: '{subject} ถูก {object} ฆ่าตาย',
                item_count: 'ฉันมี {quantity} {item}',
                item_count_single: 'ฉันมี {item} ชิ้น',
                hero_action: 'ฮีโร่ได้รับ {items}',
                male_pronoun: 'เขา',
                female_pronoun: 'เธอ',
                neutral_pronoun: 'พวกเขา',
                male_possessive: 'ของเขา',
                female_possessive: 'ของเธอ',
                neutral_possessive: 'ของพวกเขา',
                male_action: '{name} แข็งแกร่ง เขาต่อสู้อย่างกล้าหาญ',
                female_action: '{name} แข็งแกร่ง เธอต่อสู้อย่างกล้าหาญ',
                neutral_action: '{name} แข็งแกร่ง พวกเขาต่อสู้อย่างกล้าหาญ',
                game_over: 'จบเกม!',
                victory: 'ชัยชนะ!',
                level_up: 'เลเวลอัพ! ตอนนี้เลเวล {level}',
                health_low: 'คำเตือน: พลังชีวิตต่ำ!',
                mana_full: 'มานาเต็ม!',
                inventory_full: 'ไอเทมเต็ม!',
                quest_complete: 'เควสสำเร็จ: {quest_name}',
                enemy_defeated: '{enemy} ถูกกำจัด! +{exp} ประสบการณ์',
                item_found: 'พบ {item}!',
                skill_learned: 'เรียนทักษะใหม่: {skill_name}',
                player_joined: '{player_name} เข้าร่วมเกม',
                player_left: '{player_name} ออกจากเกม',
                chat_message: '[{player}]: {message}',
                system_notification: 'ระบบ: {notification}'
            }
        };
    }

    setLanguage(lang) {
        if (this.translations[lang]) {
            this.currentLang = lang;
            this.updateUI();
        }
    }

    t(key, params = {}) {
        const translation = this.translations[this.currentLang][key];
        if (!translation) return key;
        
        return this.formatString(translation, params);
    }

    formatString(str, params) {
        return str.replace(/\{(\w+)\}/g, (match, key) => {
            return params[key] !== undefined ? params[key] : match;
        });
    }

    formatPlural(quantity, itemKey) {
        const item = this.t(itemKey);
        if (quantity === 1) {
            return this.t('item_count_single', { item });
        } else {
            return this.t('item_count', { quantity, item });
        }
    }

    formatGender(gender, name) {
        const pronounKey = `${gender}_action`;
        return this.t(pronounKey, { name });
    }

    formatList(items) {
        if (items.length === 0) return '';
        if (items.length === 1) {
            return this.addArticle(items[0]);
        }
        if (items.length === 2) {
            return `${this.addArticle(items[0])} and ${this.addArticle(items[1])}`;
        }
        
        const allButLast = items.slice(0, -1).map(item => this.addArticle(item));
        const last = this.addArticle(items[items.length - 1]);
        return `${allButLast.join(', ')} and ${last}`;
    }

    addArticle(item) {
        const vowels = ['a', 'e', 'i', 'o', 'u'];
        const firstChar = item.charAt(0).toLowerCase();
        const article = vowels.includes(firstChar) ? 'an' : 'a';
        return `${article} ${item}`;
    }

    updateUI() {
        this.updateTable();
        this.updateTestResults();
    }

    updateTable() {
        const tbody = document.getElementById('locTableBody');
        tbody.innerHTML = '';

        Object.keys(this.translations.en).forEach(key => {
            const row = tbody.insertRow();
            row.insertCell(0).textContent = key;
            row.insertCell(1).textContent = this.translations.en[key];
            row.insertCell(2).textContent = this.translations.th[key];
        });
    }

    updateTestResults() {
        // Update existing test results if any
        const varResult = document.getElementById('varResult');
        if (varResult.dataset.original) {
            this.testVariableSubstitution();
        }
    }

    testVariableSubstitution(subject, object) {
        return this.t('kill_message', { subject, object });
    }

    testPlural(quantity, item) {
        return this.formatPlural(quantity, item);
    }

    testGender(gender, name) {
        return this.formatGender(gender, name);
    }

    testList(items) {
        const formattedList = this.formatList(items);
        return this.t('hero_action', { items: formattedList });
    }
}

// Initialize the localization system
const loc = new LocalizationSystem();

// Language switching
document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        loc.setLanguage(this.dataset.lang);
    });
});

// Test functions
function testVariableSubstitution() {
    const subject = document.getElementById('subject').value;
    const object = document.getElementById('object').value;
    const result = loc.testVariableSubstitution(subject, object);
    const resultDiv = document.getElementById('varResult');
    resultDiv.textContent = result;
    resultDiv.dataset.original = 'true';
}

function testPlural() {
    const quantity = parseInt(document.getElementById('quantity').value);
    const item = document.getElementById('item').value;
    const result = loc.testPlural(quantity, item);
    const resultDiv = document.getElementById('pluralResult');
    resultDiv.textContent = result;
    resultDiv.dataset.original = 'true';
}

function testGender() {
    const gender = document.getElementById('gender').value;
    const name = document.getElementById('name').value;
    const result = loc.testGender(gender, name);
    const resultDiv = document.getElementById('genderResult');
    resultDiv.textContent = result;
    resultDiv.dataset.original = 'true';
}

function testList() {
    const itemsInput = document.getElementById('items').value;
    const items = itemsInput.split(',').map(item => item.trim()).filter(item => item);
    const result = loc.testList(items);
    const resultDiv = document.getElementById('listResult');
    resultDiv.textContent = result;
    resultDiv.dataset.original = 'true';
}

// Initialize the table on page load
document.addEventListener('DOMContentLoaded', function() {
    loc.updateUI();
});