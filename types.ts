
export enum Branch {
  DOM = 'Dom',
  BACKAFFEE = 'Backaffee',
  RINGE = 'Ringe',
  MULHEIM = 'Mülheim',
  TOBACGO = 'Tobacgo'
}

export enum Role {
  ADMIN = 'Admin',
  STAFF = 'Personel'
}

export interface Employee {
  id: string;
  name: string;
  email: string;
  role: Role;
  branch: Branch;
  hourlyRate: number;
  taxClass: number; // Vergi sınıfı
  avatarUrl: string;
  advances: number; // Toplam alınan avans
  phone?: string;
  bio?: string;
}

export interface TimeLog {
  id: string;
  employeeId: string;
  date: string;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  breakDuration: number; // minutes
  totalHours: number;
  branch?: string; // Çalışılan şube
  status: 'Bekliyor' | 'Onaylandı' | 'Reddedildi';
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  assignedTo: string[]; // Changed to Array for Multiple Assignees
  dueDate: string;
  priority: 'Düşük' | 'Orta' | 'Yüksek';
  status: 'todo' | 'in_progress' | 'done'; // Kanban columns
  progress: number; // 0-100 (still useful for logic)
  checklist: { 
    id: string; 
    text: string; 
    completed: boolean; 
    completedBy?: string; // ID of the employee who completed this item
  }[];
  completedAt?: string; // Görevin tamamlandığı tarih (ISO format)
  completedBy?: string; // Görevi komple bitiren kişi
}

export interface Message {
  id: string;
  senderId: string;
  receiverId: string | 'ALL'; // 'ALL' for broadcasts
  subject: string;
  content: string;
  timestamp: string;
  read: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  type: 'Toplantı' | 'Montaj' | 'Teslim Tarihi' | 'Diğer' | 'Şube Transferi';
  date: string; // Başlangıç Tarihi
  endDate?: string; // Bitiş Tarihi (Opsiyonel, transferler için zorunlu)
  startTime: string;
  endTime: string;
  attendees: string[]; // Employee IDs
  description?: string;
}

export interface PayrollEntry {
  id: string;
  employeeId: string;
  month: string; // YYYY-MM
  approvedHours: number;
  officialHours: number; // Resmi bordro saati
  hourlyRate: number;
  advancesDeducted: number;
  netPayable: number; // Hakediş
}

export interface AppNotification {
    id: string;
    type: 'TRANSFER' | 'INFO' | 'ALERT';
    title: string;
    message: string;
    timestamp: string;
    recipientId?: string; // Sadece bu ID'ye sahip kullanıcı görür. Boş veya 'ALL' ise herkes görür.
}

export interface PersonnelTransfer {
    id: string;
    employeeId: string;
    fromBranch: string;
    toBranch: string;
    startDate: string;
    endDate: string;
    startTime: string;
    endTime: string;
    status: 'active' | 'completed' | 'cancelled';
    notes?: string;
    createdBy?: string;
    createdAt?: string;
}

export interface SalesLog {
    id: string;
    employeeId: string;
    branch: Branch;
    productName: string;
    quantity: number;
    saleDate: string;
    status: 'Bekliyor' | 'Onaylandı' | 'Reddedildi';
    createdAt: string;
}