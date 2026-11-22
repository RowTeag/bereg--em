const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createBusiness}=require('../lib/business');

test('employee and inventory data persist with audited, non-negative stock movements',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bereg-business-'));
 try{
  let store=createBusiness(directory);const actor={id:'user-1',name:'Manager'};
  const employee=store.putEmployee({name:'Example Employee',position:'Coordinator',status:'active'},null,actor);
  const product=store.putProduct({sku:'SKU-1',name:'Folder',unit:'piece',minimumStock:2},null,actor);
  store.moveStock({productId:product.id,type:'receipt',quantity:8,reason:'Opening stock'},actor);
  store.moveStock({productId:product.id,type:'issue',quantity:3,reason:'Used'},actor);
  assert.equal(store.listProducts()[0].stock,5);
  assert.throws(()=>store.moveStock({productId:product.id,type:'issue',quantity:6},actor),/negative/i);
  assert.equal(store.listMovements().length,2);
  store=createBusiness(directory);
  assert.equal(store.listEmployees()[0].id,employee.id);
  assert.equal(store.listProducts()[0].stock,5);
  assert.equal(store.summary().lowStock,0);
  assert.equal(fs.statSync(path.join(directory,'business.json')).mode&0o777,0o600);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('business export is an XLSX package with separate sheets and escaped values',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bereg-xlsx-'));
 try{
  const store=createBusiness(directory);store.putEmployee({name:'Employee <One>',position:'Manager'},null,{id:'u',name:'U'});
  const workbook=store.exportWorkbook({labels:{employeeHeaders:['Name'],productHeaders:['SKU'],movementHeaders:['Date'],employeesSheet:'Employees',productsSheet:'Inventory',movementsSheet:'Movements'}});
  assert.equal(workbook.subarray(0,4).toString('hex'),'504b0304');
  const content=workbook.toString('utf8');assert.match(content,/xl\/workbook\.xml/);assert.match(content,/Employees/);assert.match(content,/Employee &lt;One&gt;/);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
