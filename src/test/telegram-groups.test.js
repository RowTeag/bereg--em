const {test} = require('node:test');
const assert = require('node:assert/strict');
const {candidate} = require('../telegram-groups/worker');
const now = Date.now();
const config = {company:'Компания',botUrl:'https://t.me/example_bot',allowedChatIds:['-1001'],cooldownMinutes:180,dailyLimitPerChat:3,topics:[{keywords:['бухгалтер'],reply:'Поможем с бухгалтерией.'}]};
const message = {chat:{id:-1001,type:'supergroup'},from:{is_bot:false},message_id:9,date:Math.floor(now/1000),text:'Подскажите, нужен бухгалтер?'};
test('relevant question replies in the original thread with company link',()=>{
 const result = candidate({...message,message_thread_id:17},config,{chats:{}},now);
 assert.equal(result.reply_parameters.message_id,9);
 assert.equal(result.message_thread_id,17);
 assert.match(result.text,/https:\/\/t.me\/example_bot/);
});
test('ignores unapproved groups, bots, old messages, ads and unrelated topics',()=>{
 for (const changed of [{chat:{id:-2,type:'group'}},{from:{is_bot:true}},{date:1},{text:'Бухгалтер https://example.com?'},{text:'Какая погода?'},{text:'Я бухгалтер'}]) assert.equal(candidate({...message,...changed},config,{chats:{}},now),null);
});
test('cooldown and daily cap prevent repetitive replies',()=>{
 for(const previous of [{last:now-1000,day:'old',count:1},{last:now-200*60000,day:new Date(now).toISOString().slice(0,10),count:3}]) assert.equal(candidate(message,config,{chats:{'-1001':previous}},now),null);
});
