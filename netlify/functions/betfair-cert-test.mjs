import https from "node:https";

const required=["BETFAIR_USERNAME","BETFAIR_PASSWORD","BETFAIR_APP_KEY","BETFAIR_CLIENT_CERT_B64","BETFAIR_CLIENT_KEY_B64"];
const jsonResponse=(status,body)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});

const pemFromBase64=(v,type)=>{
  const raw=String(v??"").replace(/\s+/g,"");
  if(!raw) throw new Error(type+"_B64_EMPTY");
  const decoded=Buffer.from(raw,"base64").toString("utf8").trim();
  const begin=type==="CERT"?"-----BEGIN CERTIFICATE-----":"-----BEGIN PRIVATE KEY-----";
  const end=type==="CERT"?"-----END CERTIFICATE-----":"-----END PRIVATE KEY-----";
  if(!decoded.startsWith(begin)||!decoded.endsWith(end)) throw new Error(type+"_B64_NOT_VALID_PEM");
  return decoded+"\n";
};

function post(hostname,path,headers,body,cert,key){
  return new Promise((resolve,reject)=>{
    const q=https.request({
      hostname,port:443,path,method:"POST",cert,key,
      headers:{...headers,"Content-Length":Buffer.byteLength(body)}
    },r=>{
      let d="";
      r.on("data",c=>d+=c);
      r.on("end",()=>resolve({status:r.statusCode||0,contentType:r.headers["content-type"]||null,body:d}));
    });
    q.on("error",reject);
    q.write(body);
    q.end();
  });
}

export default async ()=>{
  try{
    const missing=required.filter(k=>!process.env[k]);
    if(missing.length) return jsonResponse(500,{ok:false,status:"BETFAIR_SECRETS_MISSING",missing});

    const cert=pemFromBase64(process.env.BETFAIR_CLIENT_CERT_B64,"CERT");
    const key=pemFromBase64(process.env.BETFAIR_CLIENT_KEY_B64,"KEY");
    const body=new URLSearchParams({
      username:process.env.BETFAIR_USERNAME,
      password:process.env.BETFAIR_PASSWORD
    }).toString();

    const login=await post(
      "identitysso-cert.betfair.com.au",
      "/api/certlogin",
      {
        "X-Application":process.env.BETFAIR_APP_KEY,
        "Content-Type":"application/x-www-form-urlencoded",
        "Accept":"application/json"
      },
      body,cert,key
    );

    let data=null;
    try{data=JSON.parse(login.body)}catch{}

    return jsonResponse(200,{
      ok:login.status===200 && data?.loginStatus==="SUCCESS" && !!data?.sessionToken,
      status:"BETFAIR_CERT_LOGIN_TEST",
      http_status:login.status,
      content_type:login.contentType,
      login_status:data?.loginStatus??null,
      session_token_received:!!data?.sessionToken,
      response_type:data?"json":"non_json"
    });
  }catch(err){
    return jsonResponse(500,{ok:false,status:"BETFAIR_CERT_LOGIN_ERROR",error:String(err?.message||err)});
  }
};
