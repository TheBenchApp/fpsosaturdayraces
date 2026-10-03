import assert from "node:assert/strict";
import {normalizeBetfairCatalogue,validateBetfairMeeting} from "./betfair-card.mjs";
const fixture=[
 {marketId:"1.263226052",marketName:"R1 1600m Mdn",marketStartTime:"2026-10-04T06:07:00.000Z",event:{id:"36142130",name:"Northam (AUS) 4th Oct",venue:"Northam"},runners:[
  {selectionId:103058508,runnerName:"1. Faradio",metadata:{STALL_DRAW:"2",JOCKEY_NAME:"Zephen Johnston-Porter",TRAINER_NAME:"Jim P Taylor",CLOTH_NUMBER:"1"}},
  {selectionId:103416588,runnerName:"2. Thangoo",metadata:{STALL_DRAW:"1",JOCKEY_NAME:"Test Jockey",TRAINER_NAME:"Test Trainer",CLOTH_NUMBER:"2"}}
 ]},
 {marketId:"1.263226056",marketName:"R2 1100m 3yo",marketStartTime:"2026-10-04T06:42:00.000Z",event:{id:"36142130",name:"Northam (AUS) 4th Oct",venue:"Northam"},runners:[
  {selectionId:94886304,runnerName:"1. Sovereign Rock",metadata:{STALL_DRAW:"3",JOCKEY_NAME:"J A",TRAINER_NAME:"T A",CLOTH_NUMBER:"1"}},
  {selectionId:386420,runnerName:"2. Firearm",metadata:{STALL_DRAW:"4",JOCKEY_NAME:"J B",TRAINER_NAME:"T B",CLOTH_NUMBER:"2"}}
 ]}
];
const meetings=normalizeBetfairCatalogue(fixture);
assert.equal(meetings.length,1);
assert.equal(meetings[0].venue,"Northam");
assert.equal(meetings[0].races[0].runners[0].horse_name,"Faradio");
assert.equal(meetings[0].races[0].runners[0].barrier,2);
assert.equal(meetings[0].races[0].runners[0].jockey,"Zephen Johnston-Porter");
assert.equal(validateBetfairMeeting(meetings[0]).ok,true);
const broken=structuredClone(meetings[0]); broken.races.splice(0,1);
const v=validateBetfairMeeting(broken);
assert.equal(v.ok,false); assert.equal(v.auto_generate_enabled,false); assert(v.errors.includes("missing_race_1"));
console.log("PASS Betfair catalogue normalisation");
console.log("PASS Betfair fail-closed missing-race validation");
