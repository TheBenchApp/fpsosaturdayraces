import assert from "node:assert/strict";
import {autoGenerate10} from "./auto-generate-10.mjs";

const races=[];
for(let i=0;i<14;i++){
  races.push({
    betfair_market_id:"m"+i,
    venue:i%2?"A":"B",
    race_number:i+1,
    race_name:i===4?"R5 1200m Group 1":i===8?"R9 1400m Group 2":"R"+(i+1)+" 1200m Hcp",
    start_time:new Date(Date.UTC(2026,9,4,1,30+i*30)).toISOString(),
    runners:[{runner_number:1,horse_name:"A"}]
  });
}
const card=[{venue:"Test",validation:{ok:true},races}];
const x=autoGenerate10(card);
assert.equal(x.ok,true);
assert.equal(x.selected.length,10);
assert(x.selected.some(r=>r.group_level===1));
assert(x.selected.some(r=>r.group_level===2));
for(let i=1;i<x.selected.length;i++) assert(x.selected[i].perth_minutes-x.selected[i-1].perth_minutes>=12);

const broken=autoGenerate10([{venue:"Bad",validation:{ok:false},races}]);
assert.equal(broken.ok,false);
assert.equal(broken.auto_generate_enabled,false);

console.log("PASS Auto Generate selects 10 spaced races and prioritises Group races");
console.log("PASS invalid meeting cannot feed Auto Generate");
