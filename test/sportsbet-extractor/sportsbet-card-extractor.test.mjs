import assert from "node:assert/strict";
import {extractMeetingRaceLinks,extractSportsbetAllRacing,attachSportsbetRacecard,perthDisplayTime,validateRace,validateMeeting,reconcileIdentity} from "./sportsbet-card-extractor.mjs";

const linkHtml=[
'<a href="/horse-racing/australia-nz/northam/race-1-11111111">R1</a>',
'<a href="/horse-racing/australia-nz/northam/race-2-22222222">R2</a>',
'<a href="/horse-racing/australia-nz/northam/race-3-33333333">R3</a>'
].join("");
const links=extractMeetingRaceLinks(linkHtml);
assert.equal(links.length,3); assert.equal(links[2].race_number,3); assert.equal(links[1].sportsbet_race_id,"22222222");

const runner=n=>({runner_number:n,horse_name:`Horse ${n}`,scratched:false});
const race=(n,id=String(1000+n))=>({venue:"Northam",race_number:n,sportsbet_race_id:id,runners:[runner(1),runner(2)],start_time:"2026-10-04T04:00:00Z",distance:1200,race_name:`Race ${n}`});
assert.equal(validateRace(race(1)).ok,true);
const noTime=race(1); noTime.start_time=null; assert(validateRace(noTime).errors.includes("missing_or_invalid_start_time"));
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


const apiFixture={dates:[{sections:[{displayName:"Horses",raceType:"horse",meetings:[{id:487,name:"Northam",regionName:"Australia",isInternational:false,events:[
{id:11001632,raceNumber:1,startTime:1791094020,name:"R1 Avon Valley Toyota Mdn",distance:"1600",httpLink:"Sportsbook/Racing/Events/11001632/Racecard"},
{id:11001633,raceNumber:2,startTime:1791096600,name:"R2 Tabtouch Try Bet Loop Today Mdn",distance:"1100",httpLink:"Sportsbook/Racing/Events/11001633/Racecard"}
]}]}]}]};
const apiMeetings=extractSportsbetAllRacing(apiFixture,"2026-10-04");
assert.equal(apiMeetings.length,1); assert.equal(apiMeetings[0].races[0].sportsbet_race_id,"11001632");
assert.match(apiMeetings[0].races[0].start_time,/Z$/);
const attached=attachSportsbetRacecard(apiMeetings[0].races[0],{id:11001632,name:"R1 Avon Valley Toyota Mdn",distance:"1600",startTime:1791094020,markets:[{name:"Win or Place",selections:[
{runnerNumber:1,name:"Faradio",drawNumber:2,jockey:"Zephen Johnston-Porter",trainer:"J P Taylor",isOut:false},
{runnerNumber:2,name:"Thangoo",drawNumber:6,jockey:"William Pike",trainer:"Michael Grantham",isOut:false}
]}]});
assert.equal(attached.runners.length,2); assert.equal(attached.runners[0].horse_name,"Faradio"); assert.equal(validateRace(attached).ok,true);
const wrongCard=attachSportsbetRacecard(apiMeetings[0].races[0],{id:99999999,markets:[]});
assert.equal(wrongCard.racecard_error,"event_id_mismatch"); assert.equal(validateRace(wrongCard).ok,false);

// DST safety: display conversion is always Perth/AWST, independent of venue DST.
assert.equal(perthDisplayTime("2026-10-04T05:12:00.000Z"),"13:12");
console.log("PASS Sportsbet structured startTime + racecard fixture tests");
