import React from 'react';
import {createRoot} from 'react-dom/client';
import OrderSignature from '../../app/src/pages/OrderSignature.jsx';
import 'mobile-qa.css';

createRoot(document.getElementById('root')).render(
  <><aside style={{padding:12,background:'#fff3cd'}}>SYNTHETIC MOBILE QA - use Mobile Tester and synthetic ID 012345674 only. Nothing is saved.</aside>{window.isSecureContext && typeof crypto.randomUUID === 'function' ? <OrderSignature/> : <p role="alert">Secure context unavailable. Use a device-trusted HTTPS certificate before testing.</p>}</>
);
