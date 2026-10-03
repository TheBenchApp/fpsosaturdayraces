import assert from "node:assert/strict";
import {extractMeetingRaceLinks,validateRace,validateMeeting,reconcileIdentity} from "./sportsbet-card-extractor.mjs";

const linkHtml=[
'<a href="/horse-racing/australia-nz/northam/race-1-11111111">R1</a>',
'<a href="/horse-racing/australia-nz/northam/race-2-22222222">R2</a>',
'<a href="/horse-racing/australia-nz/northam/race-3-33333333">R3</a>'
].join("");
const links=extractMeetingRaceLinks(linkHtml);
assert.equal(links.length,3); assert.equal(links[2].race_number,3); assert.equal(links[1].sportsbet_race_id,"22222222");

const runner=n=>({runner_number:n,horse_name:`Horse ${n}`,scratched:false});
const race=(n,id=String(1000+n))=>({venue:"Northam",race_number:n,sportsbet_race_id:id,runners:[runner(1),runner(2)],start_time:"2026-10-04T04:00:00Z",distance:1200,race_name:`Race ${n}`});
assert.equal(validateRace(race(1)).ok,true);\nconst noTime=race(1); noTime.start_time=null; assert(validateRace(noTime).errors.includes("missing_or_invalid_start_time"));
assert.equal(validateMeeting({venue:"Northam",expected_race_count:3,races:[race(1),race(2),race(3)]}).ok,true);

const missing=validateMeeting({venue:"Northam",expected_race_count:3,races:[race(1),race(3)]});
assert.equal(missing.ok,false); assert.equal(missing.auto_generate_enabled,false); assert(missing.errors.includes("missing_race_2"));

const duplicateRunner=race(1); duplicateRunner.runners=[runner(1),runner(1)];
assert(validateRace(duplicateRunner).errors.includes("duplicate_runner_number"));

const truncated=validateMeeting({venue:"Townsville",expected_race_count:9,races:[race(1),race(2)]});
assert.equal(truncated.status,"AU CARD INCOMPLETE"); assert.equal(truncated.auto_generate_enabled,false);

const malformed=race(1); malformed.runners=[{runner_number:1,horse_name:""},{runner_number:2,horse_name:"Horse 2"}];
assert(validateRace(malformed).errors.includes("missing_horse_name"));

assert.deepEqual(reconcileIdentity({runner_number:4,horse_name:"Big Horse"},{runner_number:4,horse_name:"Big Horse"}),{ok:true});
assert.deepEqual(reconcileIdentity({runner_number:4,horse_name:"Big Horse"},{runner_number:4,horse_name:"Different Horse"}),{ok:false,reason:"horse_identity_conflict"});
assert.deepEqual(reconcileIdentity({runner_number:4,horse_name:"Big Horse"},{runner_number:5,horse_name:"Big Horse"}),{ok:false,reason:"runner_number_mismatch"});

console.log("PASS sportsbet extractor validation stress tests");
