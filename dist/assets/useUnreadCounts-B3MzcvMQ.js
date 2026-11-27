import{d as o,u as d,r as a,s}from"./index-DKiaXmWf.js";/**
 * @license lucide-react v0.462.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const y=o("Bell",[["path",{d:"M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9",key:"1qo2s2"}],["path",{d:"M10.3 21a1.94 1.94 0 0 0 3.4 0",key:"qgo35s"}]]);/**
 * @license lucide-react v0.462.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const g=o("ChevronDown",[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]);/**
 * @license lucide-react v0.462.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const m=o("LogOut",[["path",{d:"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",key:"1uf3rs"}],["polyline",{points:"16 17 21 12 16 7",key:"1gabdz"}],["line",{x1:"21",x2:"9",y1:"12",y2:"12",key:"1uyos4"}]]);/**
 * @license lucide-react v0.462.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const p=o("Menu",[["line",{x1:"4",x2:"20",y1:"12",y2:"12",key:"1e0a9i"}],["line",{x1:"4",x2:"20",y1:"6",y2:"6",key:"1owob3"}],["line",{x1:"4",x2:"20",y1:"18",y2:"18",key:"yk5zj1"}]]),b=()=>{const{user:i}=d(),e=i==null?void 0:i.id,[l,r]=a.useState({messages:0,notifications:0}),[f,u]=a.useState(!0),n=a.useCallback(async()=>{if(!e){r({messages:0,notifications:0}),u(!1);return}try{const[t,c]=await Promise.all([s.from("messages").select("id",{count:"exact",head:!0}).eq("recipient_id",e).eq("is_read",!1),s.from("notifications").select("id",{count:"exact",head:!0}).eq("user_id",e).eq("is_read",!1)]);r({messages:t.count||0,notifications:c.count||0})}catch(t){console.error("Error fetching unread counts:",t)}finally{u(!1)}},[e]);return a.useEffect(()=>{if(n(),!e)return;const t=s.channel("unread-messages").on("postgres_changes",{event:"*",schema:"public",table:"messages",filter:`recipient_id=eq.${e}`},()=>{n()}).subscribe(),c=s.channel("unread-notifications").on("postgres_changes",{event:"*",schema:"public",table:"notifications",filter:`user_id=eq.${e}`},()=>{n()}).subscribe();return()=>{s.removeChannel(t),s.removeChannel(c)}},[e,n]),{...l,isLoading:f,refetch:n}};export{y as B,g as C,m as L,p as M,b as u};
