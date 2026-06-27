import React from 'react';
import useStore from '../store/useStore';
import './Notification.css';

export default function Notification() {
  const { notification } = useStore();
  if (!notification) return null;

  const icons = { success: '✓', error: '✕', info: '◈', warning: '⚠' };

  return (
    <div className={`notification notification-${notification.type || 'info'}`} key={notification.id}>
      <span className="notif-icon">{icons[notification.type] || '◈'}</span>
      <span className="notif-msg">{notification.msg}</span>
    </div>
  );
}
