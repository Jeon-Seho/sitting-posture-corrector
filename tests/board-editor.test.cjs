const {test} = require('node:test');
const assert = require('node:assert/strict');
const {merge,noteStatus} = require('../tools/project-board/editor-state.js');
const base = () => ({cards:[{id:'a',assignees:[],status:'planned'},{id:'b',status:'planned'}],notes:[{id:'n',body:'old'}],assignments:{plan:[]},nextNumber:3});
test('assignment save preserves another card update and numbering',()=>{
 const before=base(), latest=base(); latest.cards[1].status='completed';latest.nextNumber=4;
 const result=merge(before,latest,'card','a',{...before.cards[0],assignees:['우진']});
 assert.deepEqual(result.cards[0].assignees,['우진']);assert.equal(result.cards[1].status,'completed');assert.equal(result.nextNumber,4);assert.deepEqual(before.cards[0].assignees,[]);
});
test('memo save preserves concurrent card edits',()=>{
 const before=base(),latest=base();latest.cards[0].status='review';
 const result=merge(before,latest,'notes','n',{id:'n',body:'new'});
 assert.equal(result.notes[0].body,'new');assert.equal(result.cards[0].status,'review');
});
test('same item changes or deletion must not be overwritten',()=>{
 const before=base(),latest=base();latest.notes[0].body='other';
 assert.throws(()=>merge(before,latest,'notes','n',{id:'n',body:'mine'}),/다른 창/);
 latest.cards=[];assert.throws(()=>merge(before,latest,'card','a',before.cards[0]),/다른 창/);
});
test('new memo preserves existing concurrent memo',()=>{
 const before=base(),latest=base();latest.notes.push({id:'other',body:'theirs'});
 assert.equal(merge(before,latest,'notes','new',{id:'new',body:'mine'}).notes.length,3);
});
test('plan assignments merge only when that plan is unchanged',()=>{
 const before=base(),latest=base();latest.assignments.other=['동욱'];
 assert.deepEqual(merge(before,latest,'plan','plan',['우진']).assignments,{plan:['우진'],other:['동욱']});
 latest.assignments.plan=['세호'];assert.throws(()=>merge(before,latest,'plan','plan',['우진']),/다른 창/);
});
test('explicit memo status change survives simultaneous content edit',()=>{
 assert.equal(noteStatus({title:'a',body:'old',status:'planned'},{title:'a',body:'new',status:'in_progress'}),'in_progress');
});
test('new request reopens previously processed memo if status is unchanged',()=>{
 assert.equal(noteStatus({title:'a',body:'old',status:'completed'},{title:'a',body:'new',status:'completed'}),'planned');
});
