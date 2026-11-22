const ICAL=require('ical.js');
function readBookings(text){
  if(typeof text!=='string'||text.length>2_000_000)throw Error('Выберите файл календаря до 2 МБ.');
  const calendar=new ICAL.Component(ICAL.parse(text));
  if(calendar.name!=='vcalendar')throw Error('Ожидается календарь ICS.');
  const entries=calendar.getAllSubcomponents('vevent');
  if(entries.length>5000)throw Error('Слишком много записей в файле.');
  return entries.map(event=>{
    const uid=event.getFirstPropertyValue('uid'),start=event.getFirstPropertyValue('dtstart');
    if(!uid||!start)throw Error('У записи отсутствует UID или время начала.');
    const recurrence=event.getFirstPropertyValue('recurrence-id')?.toString()||'';
    return {id:JSON.stringify([uid,recurrence]),title:String(event.getFirstPropertyValue('summary')||'Запись'),
      start:start.toString(),zone:start.zone?.tzid||'',status:String(event.getFirstPropertyValue('status')||''),
      recurring:event.hasProperty('rrule')};
  });
}
module.exports={readBookings};
