require('dotenv').config();
const express=require('express'),session=require('express-session'),helmet=require('helmet'),path=require('path');
const db=require('./config/database');
db.exec('CREATE TABLE IF NOT EXISTS sesiones (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expira INTEGER NOT NULL)');
class SessionStore extends session.Store {
  get(sid,cb){try{const x=db.prepare('SELECT sess FROM sesiones WHERE sid=? AND expira>?').get(sid,Date.now());cb(null,x?JSON.parse(x.sess):null)}catch(e){cb(e)}}
  set(sid,s,cb){try{const expira=s.cookie?.expires?new Date(s.cookie.expires).getTime():Date.now()+28800000;db.prepare(`INSERT INTO sesiones(sid,sess,expira) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess,expira=excluded.expira`).run(sid,JSON.stringify(s),expira);cb?.()}catch(e){cb?.(e)}}
  destroy(sid,cb){try{db.prepare('DELETE FROM sesiones WHERE sid=?').run(sid);cb?.()}catch(e){cb?.(e)}}
}
const app=express();
app.set('trust proxy', 1);
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:'1mb'}));app.use(express.urlencoded({extended:false}));
app.use(session({store:new SessionStore(),name:'bodega.sid',
  secret:process.env.SESSION_SECRET||'desarrollo-cambie-esta-clave',resave:false,saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:8*60*60*1000}}));
app.use('/vendor/html5-qrcode',express.static(path.resolve('node_modules/html5-qrcode')));
app.use(express.static(path.resolve('public')));
app.get('/health',(req,res)=>res.json({status:'ok'}));
app.use('/api',require('./routes'));
app.use((req,res,next)=>req.method==='GET'?res.sendFile(path.resolve('src/views/index.html')):next());
app.use(require('./middleware/errors'));
const port=Number(process.env.PORT||3000);
app.listen(port,()=>console.log(`Licorería La 11 disponible en http://localhost:${port}`));
module.exports=app;
