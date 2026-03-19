import React, { useState, useEffect, useRef } from 'react';
import { Message, Employee, Role } from '../types';
import { Search, Send, Mail, ChevronLeft, MessageSquare, Plus, X, Loader2, Check, CheckCheck, ShieldAlert, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../lib/i18n';
import { GlowingEffect } from './ui/glowing-effect';


interface MessagesProps {
    currentUser: Employee;
}

const ADMIN_BOARD_ID = 'ADMIN_BOARD';

const Messages: React.FC<MessagesProps> = ({ currentUser }) => {
    // Mesaj Listesi (Sol Panel)
    const [messages, setMessages] = useState<Message[]>([]);
    
    // Aktif Sohbet
    const [activeChatPartnerId, setActiveChatPartnerId] = useState<string | null>(null);
    const [conversation, setConversation] = useState<Message[]>([]);
    
    const [isLoading, setIsLoading] = useState(true);
    const [loadingConversation, setLoadingConversation] = useState(false);
    const [replyText, setReplyText] = useState('');
    const [isSending, setIsSending] = useState(false);
    
    const scrollRef = useRef<HTMLDivElement>(null);
    
    const { t } = useLanguage();

    // Gerçek kullanıcı listesi
    const [recipientList, setRecipientList] = useState<Employee[]>([]);

    // Compose Modal
    const [showCompose, setShowCompose] = useState(false);
    const [composeForm, setComposeForm] = useState({
        receiverId: '',
        subject: '',
        content: ''
    });

    // Helper: ID'den İsim Bulma
    const getName = (id: string) => {
        if (id === currentUser.id) return 'Ben';
        if (id === 'ALL') return '📢 Tüm Personel';
        if (id === ADMIN_BOARD_ID) return '🏢 Yönetim Ekibi';
        const user = recipientList.find(e => e.id === id);
        return user ? user.name : 'Bilinmeyen Kullanıcı';
    };

    // Helper: ID'den Profil Resmi Bulma
    const getAvatar = (id: string) => {
        if (id === ADMIN_BOARD_ID) return null; // Özel ikon kullanılacak
        const user = recipientList.find(e => e.id === id);
        return user ? user.avatarUrl : null;
    };

    // Helper: Admin mi kontrolü
    const isAdmin = (id: string) => {
        const user = recipientList.find(e => e.id === id);
        return user?.role === Role.ADMIN;
    };

    // 1. Başlangıç Verilerini Çek
    useEffect(() => {
        fetchPotentialRecipients().then(() => {
            // Recipient list yüklendikten sonra mesajları çek ki Admin check yapabilelim
            fetchMessages(); 
        });
    }, [currentUser]);

    // 2. Realtime Aboneliği
    useEffect(() => {
        const channel = supabase.channel('messages-core')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
                const newMsg = payload.new;
                
                // Realtime filtreleme:
                // 1. Bana geldi (receiver_id = me)
                // 2. Ben attım (sender_id = me)
                // 3. Herkese atıldı (ALL)
                // 4. ADMIN ise ve mesaj ADMIN_BOARD'a atıldıysa
                
                let isRelevant = false;

                if (newMsg.receiver_id === currentUser.id || newMsg.sender_id === currentUser.id || newMsg.receiver_id === 'ALL') {
                    isRelevant = true;
                } else if (currentUser.role === Role.ADMIN && newMsg.receiver_id === ADMIN_BOARD_ID) {
                    isRelevant = true;
                }

                if (isRelevant) {
                     fetchMessages();

                     // Aktif sohbet güncelleme mantığı
                     if (activeChatPartnerId) {
                         // Eğer Personel isem ve 'ADMIN_BOARD' açıksa:
                         // Gelen mesaj Admin'den bana ise VEYA ben Admin'e attıysam
                         if (currentUser.role !== Role.ADMIN && activeChatPartnerId === ADMIN_BOARD_ID) {
                             if (newMsg.receiver_id === currentUser.id || newMsg.receiver_id === ADMIN_BOARD_ID) {
                                 fetchConversation(ADMIN_BOARD_ID);
                             }
                         }
                         // Eğer Admin isem:
                         else {
                             // Mesajı atan şu an konuştuğum kişiyse (veya ben ona attıysam)
                             const senderIsActive = newMsg.sender_id === activeChatPartnerId;
                             const receiverIsActive = newMsg.receiver_id === activeChatPartnerId;
                             
                             // Admin olarak ben Staff'a cevap yazdıysam
                             const iRepliedToActive = newMsg.sender_id === currentUser.id && newMsg.receiver_id === activeChatPartnerId;

                             // Staff, ADMIN_BOARD'a yazdıysa ve ben o Staff ile konuşuyorsam
                             const staffWroteToBoard = newMsg.sender_id === activeChatPartnerId && newMsg.receiver_id === ADMIN_BOARD_ID;

                             if (senderIsActive || receiverIsActive || iRepliedToActive || staffWroteToBoard) {
                                fetchConversation(activeChatPartnerId);
                             }
                         }
                     }
                }
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, () => {
                fetchMessages(); 
                if(activeChatPartnerId) fetchConversation(activeChatPartnerId);
            })
            .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, () => {
                // Silme durumunda listeyi yenile
                if(activeChatPartnerId) fetchConversation(activeChatPartnerId);
                fetchMessages();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [currentUser, activeChatPartnerId]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [conversation]);

    useEffect(() => {
        if (activeChatPartnerId) {
            fetchConversation(activeChatPartnerId);
        } else {
            setConversation([]);
        }
    }, [activeChatPartnerId]);

    const fetchPotentialRecipients = async () => {
        let query = supabase.from('profiles').select('id, full_name, email, role, branch, avatar_url');

        // Personel sadece Admin profillerini ve kendi profilini görebilir
        if (currentUser.role !== Role.ADMIN) {
            query = query.or(`role.eq.Admin,id.eq.${currentUser.id}`);
        }

        const { data } = await query;
        if (data) {
            const formattedEmps: Employee[] = data.map((e: any) => ({
                id: e.id,
                name: e.full_name,
                email: e.email,
                role: e.role as Role,
                branch: e.branch,
                hourlyRate: 0,
                taxClass: 0,
                avatarUrl: e.avatar_url || `https://ui-avatars.com/api/?name=${e.full_name}`,
                advances: 0,
            }));
            setRecipientList(formattedEmps);
        }
    };

    const fetchMessages = async () => {
        try {
            let query = supabase.from('messages').select('*').order('timestamp', { ascending: false });

            // SORGULAMA MANTIĞI:
            if (currentUser.role === Role.ADMIN) {
                // Admin: Kendisine gelen, Kendisinin attığı, ALL, ve ADMIN_BOARD'a gelenler
                query = query.or(`receiver_id.eq.${currentUser.id},sender_id.eq.${currentUser.id},receiver_id.eq.ALL,receiver_id.eq.${ADMIN_BOARD_ID}`);
            } else {
                // Personel: Kendisine gelen, Kendisinin attığı, ALL
                // (Personel ADMIN_BOARD'a attığında sender_id kendisi olduğu için zaten gelir)
                query = query.or(`receiver_id.eq.${currentUser.id},sender_id.eq.${currentUser.id},receiver_id.eq.ALL`);
            }

            const { data, error } = await query;
            if (error) throw error;

            let formattedMessages: Message[] = (data || []).map((m: any) => ({
                id: m.id,
                senderId: m.sender_id,
                receiverId: m.receiver_id,
                subject: m.subject,
                content: m.content,
                timestamp: m.timestamp,
                read: m.read
            }));

            // GÜVENLİK: Personel için ek filtreleme - sadece kendine ait mesajlar
            if (currentUser.role !== Role.ADMIN) {
                formattedMessages = formattedMessages.filter(m =>
                    m.senderId === currentUser.id ||
                    m.receiverId === currentUser.id ||
                    m.receiverId === 'ALL'
                );
            }

            // --- GRUPLAMA MANTIĞI ---
            const uniqueChats: Message[] = [];
            const seenPartners = new Set();

            formattedMessages.forEach(msg => {
                let partnerId = '';

                if (currentUser.role === Role.ADMIN) {
                    // ADMIN GÖZÜNDEN:
                    if (msg.receiverId === 'ALL') {
                        partnerId = 'ALL';
                    } else if (msg.receiverId === ADMIN_BOARD_ID) {
                        // Eğer mesaj Yönetim Havuzuna geldiyse, partner gönderen personeldir.
                        partnerId = msg.senderId;
                    } else if (msg.senderId === currentUser.id) {
                        // Ben birine attım, partner alıcıdır.
                        partnerId = msg.receiverId;
                    } else {
                        // Biri bana attı (Özel mesaj varsa)
                        partnerId = msg.senderId;
                    }
                } else {
                    // PERSONEL GÖZÜNDEN:
                    if (msg.receiverId === 'ALL') {
                        partnerId = 'ALL';
                    } else {
                        // Diğer tüm durumlar (Benim yönetime attığım veya Yönetimin bana attığı)
                        // Tek bir çatı altında toplanmalı: 'ADMIN_BOARD'
                        partnerId = ADMIN_BOARD_ID;
                    }
                }
                
                // Kendi kendime mesajlaşmayı engelle (Nadir durum)
                if (partnerId === currentUser.id) return;

                if (partnerId && !seenPartners.has(partnerId)) {
                    seenPartners.add(partnerId);
                    uniqueChats.push(msg);
                }
            });

            setMessages(uniqueChats);
            setIsLoading(false);
        } catch (error) {
            console.error("Mesajlar alınamadı:", error);
            setIsLoading(false);
        }
    };

    const fetchConversation = async (partnerId: string) => {
        if(conversation.length === 0) setLoadingConversation(true);
        
        try {
            let query = supabase.from('messages').select('*').order('timestamp', { ascending: true });

            if (partnerId === 'ALL') {
                query = query.eq('receiver_id', 'ALL');
            } else if (currentUser.role === Role.ADMIN) {
                // ADMIN OLARAK SOHBET GEÇMİŞİ (REVİZE EDİLDİ):
                // 1. Partnerin ADMIN_BOARD'a attıkları (Ortak Havuz)
                // 2. Partnerin BANA attıkları
                // 3. BENİM Partnere attıklarım
                // 4. (ÇIKARILDI) -> BAŞKA ADMİNLERİN Partnere attıkları (Gizlilik Kuralı)
                query = query.or(`and(sender_id.eq.${partnerId},receiver_id.eq.${ADMIN_BOARD_ID}),and(sender_id.eq.${partnerId},receiver_id.eq.${currentUser.id}),and(sender_id.eq.${currentUser.id},receiver_id.eq.${partnerId})`);
            } else {
                // PERSONEL OLARAK SOHBET GEÇMİŞİ (partnerId = ADMIN_BOARD):
                // 1. BENİM ADMIN_BOARD'a attıklarım
                // 2. HERHANGİ BİR ADMININ BANA attıkları (receiver_id = ME)
                if (partnerId === ADMIN_BOARD_ID) {
                     query = query.or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${ADMIN_BOARD_ID}),and(receiver_id.eq.${currentUser.id},sender_id.neq.${currentUser.id})`);
                } else {
                     // Güvenlik: Personel için beklenmeyen partnerId - boş döndür
                     setConversation([]);
                     setLoadingConversation(false);
                     return;
                }
            }

            const { data, error } = await query;
            if (error) throw error;

            const formattedConv: Message[] = (data || []).map((m: any) => ({
                id: m.id,
                senderId: m.sender_id,
                receiverId: m.receiver_id,
                subject: m.subject,
                content: m.content,
                timestamp: m.timestamp,
                read: m.read
            }));

            // Sadece ADMIN_BOARD dışı mesajları filtrele (Personel için ALL karışmasın)
            let cleanConv = partnerId === 'ALL'
                ? formattedConv
                : formattedConv.filter(m => m.receiverId !== 'ALL');

            // GÜVENLİK: Personel için ek filtreleme - sadece kendi mesajları ve admin'den gelen mesajlar
            if (currentUser.role !== Role.ADMIN && partnerId === ADMIN_BOARD_ID) {
                const adminIds = new Set(recipientList.filter(u => u.role === Role.ADMIN).map(u => u.id));
                cleanConv = cleanConv.filter(m =>
                    m.senderId === currentUser.id || adminIds.has(m.senderId)
                );
            }

            setConversation(cleanConv);

            // Okundu İşaretleme
            if (partnerId !== 'ALL') {
                const unreadMsgIds = cleanConv
                    .filter(m => !m.read && m.senderId !== currentUser.id) // Başkası attıysa ve okunmadıysa
                    .map(m => m.id);

                if (unreadMsgIds.length > 0) {
                    await supabase.from('messages').update({ read: true }).in('id', unreadMsgIds);
                    fetchMessages(); 
                }
            }

        } catch (err) {
            console.error("Sohbet geçmişi hatası:", err);
        } finally {
            setLoadingConversation(false);
        }
    };

    const handleSelectChat = (msg: Message) => {
        let partnerId = '';
        if (currentUser.role === Role.ADMIN) {
            if (msg.receiverId === 'ALL') partnerId = 'ALL';
            else if (msg.receiverId === ADMIN_BOARD_ID) partnerId = msg.senderId;
            else if (msg.senderId === currentUser.id) partnerId = msg.receiverId;
            else partnerId = msg.senderId;
        } else {
            if (msg.receiverId === 'ALL') partnerId = 'ALL';
            else partnerId = ADMIN_BOARD_ID;
        }
        setActiveChatPartnerId(partnerId);
    };

    const handleDeleteMessage = async (msgId: string) => {
        if (!confirm('Bu mesajı silmek istediğinize emin misiniz?')) return;
        try {
            const { error } = await supabase.from('messages').delete().eq('id', msgId);
            if (error) throw error;
            // Local update (Realtime will also handle this but this makes it snappier)
            setConversation(prev => prev.filter(m => m.id !== msgId));
        } catch (err: any) {
            alert('Silme hatası: ' + err.message);
        }
    };

    const handleSendReply = async () => {
        if (!replyText.trim() || !activeChatPartnerId) return;
        setIsSending(true);

        try {
            let receiver = activeChatPartnerId;
            
            // Eğer personel isem ve "Yönetim Ekibi" seçiliyse, mesaj ADMIN_BOARD'a gider.
            if (currentUser.role !== Role.ADMIN && activeChatPartnerId === ADMIN_BOARD_ID) {
                receiver = ADMIN_BOARD_ID;
            }

            const newMessage = {
                sender_id: currentUser.id,
                receiver_id: receiver,
                subject: 'Sohbet Mesajı',
                content: replyText,
                read: false
            };

            const { error } = await supabase.from('messages').insert([newMessage]);
            if (error) throw error;

            setReplyText('');
            
        } catch (err: any) {
            alert("Gönderilemedi: " + err.message);
        } finally {
            setIsSending(false);
        }
    };

    const handleComposeSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!composeForm.receiverId || !composeForm.content) {
            alert("Alıcı ve mesaj içeriği zorunludur.");
            return;
        }

        setIsSending(true);
        try {
            const newMessage = {
                sender_id: currentUser.id,
                receiver_id: composeForm.receiverId,
                subject: composeForm.subject || 'Yeni Mesaj',
                content: composeForm.content,
                read: false
            };

            const { error } = await supabase.from('messages').insert([newMessage]);
            if (error) throw error;

            setShowCompose(false);
            setComposeForm({ receiverId: '', subject: '', content: '' });
            alert("Mesaj gönderildi.");
            
            // Sohbete geçiş yap
            let nextPartner = composeForm.receiverId;
            // Personel Yönetime attıysa, sohbet ID'si ADMIN_BOARD_ID olur
            if (currentUser.role !== Role.ADMIN && composeForm.receiverId === ADMIN_BOARD_ID) {
                nextPartner = ADMIN_BOARD_ID;
            }
            setActiveChatPartnerId(nextPartner);

        } catch (err: any) {
            alert("Hata: " + err.message);
        } finally {
            setIsSending(false);
        }
    };

    const handleOpenCompose = () => {
        // Varsayılan alıcı: Admin değilse Yönetim, Adminse boş
        const defaultReceiver = currentUser.role !== Role.ADMIN ? ADMIN_BOARD_ID : '';
        setComposeForm({ receiverId: defaultReceiver, subject: '', content: '' });
        setShowCompose(true);
    };

    // UI Helpers: Compose Dropdown Listesi
    const filteredRecipients = recipientList.filter(user => {
        if (user.id === currentUser.id) return false;
        // Personel sadece Yönetim'e atabilir (Dropdown'da özel seçenek olacak)
        // Admin herkese atabilir.
        return currentUser.role === Role.ADMIN;
    });

    return (
        <div className="flex h-full flex-col md:flex-row relative overflow-hidden bg-zinc-950">
            
            {/* COMPOSE MODAL */}
            {showCompose && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in-95">
                        <div className="p-5 border-b border-zinc-800 flex justify-between items-center bg-zinc-950/50">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <Mail size={20} className="text-indigo-500" /> {t('msg.compose')}
                            </h3>
                            <button onClick={() => setShowCompose(false)} className="text-zinc-500 hover:text-white"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleComposeSend} className="p-6 space-y-4">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-zinc-400">{t('msg.recipient')}</label>
                                <select 
                                    value={composeForm.receiverId} 
                                    onChange={e => setComposeForm({...composeForm, receiverId: e.target.value})}
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white focus:border-indigo-500 outline-none"
                                >
                                    {/* Personel için tek seçenek */}
                                    {currentUser.role !== Role.ADMIN && (
                                        <option value={ADMIN_BOARD_ID}>🏢 Yönetim Ekibi (Admin)</option>
                                    )}
                                    
                                    {/* Admin için seçenekler */}
                                    {currentUser.role === Role.ADMIN && (
                                        <>
                                            <option value="" disabled>Seçiniz</option>
                                            <option value="ALL">📢 Tüm Personel (Duyuru)</option>
                                            {filteredRecipients.map(emp => (
                                                <option key={emp.id} value={emp.id}>{emp.name} — {emp.branch}</option>
                                            ))}
                                        </>
                                    )}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-zinc-400">{t('msg.subject')} (Opsiyonel)</label>
                                <input 
                                    type="text" 
                                    value={composeForm.subject}
                                    onChange={e => setComposeForm({...composeForm, subject: e.target.value})}
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white focus:border-indigo-500 outline-none"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-zinc-400">{t('msg.content')}</label>
                                <textarea 
                                    value={composeForm.content}
                                    onChange={e => setComposeForm({...composeForm, content: e.target.value})}
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white focus:border-indigo-500 outline-none min-h-[100px]"
                                />
                            </div>
                            <button 
                                type="submit" 
                                disabled={isSending}
                                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium shadow-lg flex items-center justify-center gap-2"
                            >
                                {isSending ? <Loader2 className="animate-spin" size={18}/> : t('msg.send')}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* LIST PANEL (SOL) */}
            <div className={`w-full md:w-1/3 min-w-[300px] border-r border-zinc-800 flex flex-col bg-zinc-950/50 absolute md:relative inset-0 z-10 md:z-auto transition-transform duration-300 ${activeChatPartnerId ? '-translate-x-full md:translate-x-0' : 'translate-x-0'}`}>
                <div className="p-4 border-b border-zinc-800">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="font-bold text-white text-lg">{t('msg.chats')}</h2>
                        <button onClick={handleOpenCompose} className="bg-indigo-600 p-2 rounded-lg text-white hover:bg-indigo-500 shadow-lg flex items-center gap-2 px-3">
                            <Plus size={18} /> <span className="text-xs font-bold">{t('msg.new')}</span>
                        </button>
                    </div>
                    <div className="relative">
                        <Search size={16} className="absolute left-3 top-2.5 text-zinc-500" />
                        <input type="text" placeholder={t('msg.search')} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:border-indigo-500 outline-none text-zinc-300" />
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {isLoading ? (
                        <div className="flex justify-center p-8"><Loader2 className="animate-spin text-zinc-500"/></div>
                    ) : messages.length === 0 ? (
                        <div className="text-center p-8 text-zinc-600 text-sm">{t('msg.empty')}</div>
                    ) : (
                        messages.map(msg => {
                            const isMe = msg.senderId === currentUser.id;
                            
                            let partnerId = '';
                            if (currentUser.role === Role.ADMIN) {
                                if (msg.receiverId === 'ALL') partnerId = 'ALL';
                                else if (msg.receiverId === ADMIN_BOARD_ID) partnerId = msg.senderId;
                                else if (isMe) partnerId = msg.receiverId;
                                else partnerId = msg.senderId;
                            } else {
                                if (msg.receiverId === 'ALL') partnerId = 'ALL';
                                else partnerId = ADMIN_BOARD_ID;
                            }

                            const partnerName = getName(partnerId);
                            const isActive = activeChatPartnerId === partnerId;
                            
                            const showUnread = !msg.read && !isMe && partnerId !== 'ALL';

                            return (
                                <div 
                                    key={msg.id}
                                    onClick={() => handleSelectChat(msg)}
                                    className={`p-4 border-b border-zinc-800/50 cursor-pointer hover:bg-zinc-900/80 transition-all ${isActive ? 'bg-indigo-900/10 border-l-2 border-l-indigo-500' : 'border-l-2 border-l-transparent'} ${showUnread ? 'bg-zinc-900/40' : ''}`}
                                >
                                    <div className="flex justify-between mb-1.5">
                                        <div className="flex items-center gap-2">
                                            {showUnread && <div className="w-2 h-2 rounded-full bg-indigo-500"></div>}
                                            {/* Özel İkonlar */}
                                            {partnerId === ADMIN_BOARD_ID && <ShieldAlert size={14} className="text-indigo-400" />}
                                            
                                            <span className={`text-sm font-medium ${showUnread ? 'text-white' : 'text-zinc-400'}`}>
                                                {partnerName}
                                            </span>
                                        </div>
                                        <span className="text-[10px] text-zinc-600">
                                            {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                        </span>
                                    </div>
                                    <p className="text-xs text-zinc-500 truncate">
                                        {isMe && <span className="text-zinc-600">Siz: </span>}{msg.content}
                                    </p>
                                </div>
                            )
                        })
                    )}
                </div>
            </div>

            {/* CHAT PANEL (SAĞ) */}
            <div className={`flex-1 flex flex-col bg-zinc-950 absolute md:relative inset-0 z-20 md:z-auto transition-transform duration-300 ${activeChatPartnerId ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}`}>
                {activeChatPartnerId ? (
                    <>
                        <div className="p-4 border-b border-zinc-800 bg-zinc-900/30 backdrop-blur-md flex items-center gap-3">
                            <button onClick={() => setActiveChatPartnerId(null)} className="md:hidden text-zinc-400 hover:text-white"><ChevronLeft size={24} /></button>
                            
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-800 to-zinc-800 flex items-center justify-center text-white font-bold border border-zinc-700 overflow-hidden relative">
                                {activeChatPartnerId === ADMIN_BOARD_ID ? (
                                    <ShieldAlert size={20} />
                                ) : getAvatar(activeChatPartnerId) ? (
                                    <img src={getAvatar(activeChatPartnerId)!} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                ) : (
                                    getName(activeChatPartnerId).charAt(0)
                                )}
                            </div>
                            
                            <div>
                                <h2 className="text-base font-bold text-white">{getName(activeChatPartnerId)}</h2>
                                <p className="text-xs text-zinc-500">
                                    {activeChatPartnerId === 'ALL' ? 'Genel Duyuru Kanalı' : 
                                     activeChatPartnerId === ADMIN_BOARD_ID ? 'Yönetim Departmanı' : 'Personel'}
                                </p>
                            </div>
                        </div>

                        <div ref={scrollRef} className="flex-1 p-4 md:p-6 overflow-y-auto custom-scrollbar space-y-4">
                            {conversation.map((msg, index) => {
                                const isMe = msg.senderId === currentUser.id;
                                const isContinuous = index > 0 && conversation[index-1].senderId === msg.senderId;

                                return (
                                    <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'} ${isContinuous ? 'mt-1' : 'mt-4'} group`}>
                                        
                                        {/* Admin Delete Button (Appears on hover or persistent) */}
                                        {currentUser.role === Role.ADMIN && (
                                            <button 
                                                onClick={() => handleDeleteMessage(msg.id)}
                                                className={`p-1 text-zinc-600 hover:text-red-500 transition-opacity opacity-0 group-hover:opacity-100 ${isMe ? 'mr-2' : 'ml-2 order-2'}`}
                                                title="Mesajı Sil"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        )}

                                        <div className={`max-w-[80%] md:max-w-[60%] rounded-2xl px-4 py-2.5 text-sm relative ${
                                            isMe 
                                            ? 'bg-indigo-600 text-white rounded-br-none' 
                                            : 'bg-zinc-800 text-zinc-200 rounded-bl-none border border-zinc-700'
                                        }`}>
                                            {/* GÖNDEREN İSMİ (Gelen mesajlarda göster) */}
                                            {!isMe && !isContinuous && (
                                                <div className={`text-[10px] font-bold mb-1 ${isAdmin(msg.senderId) ? 'text-indigo-400 flex items-center gap-1' : 'text-zinc-400'}`}>
                                                    {isAdmin(msg.senderId) && <ShieldAlert size={10} />}
                                                    {getName(msg.senderId)}
                                                </div>
                                            )}
                                            
                                            <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                                            <div className={`text-[9px] mt-1 text-right flex items-center justify-end gap-1 ${isMe ? 'text-indigo-200' : 'text-zinc-500'}`}>
                                                {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                                {isMe && (msg.read ? <CheckCheck size={12}/> : <Check size={12}/>)}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                            {loadingConversation && <div className="text-center py-4"><Loader2 className="animate-spin inline text-zinc-600"/></div>}
                        </div>

                        <div className="p-4 border-t border-zinc-800 bg-zinc-900/30 pb-safe">
                            <div className="flex gap-2 items-end bg-zinc-900 border border-zinc-800 rounded-2xl p-2">
                                <textarea 
                                    value={replyText}
                                    onChange={(e) => setReplyText(e.target.value)}
                                    className="flex-1 bg-transparent border-none text-sm focus:ring-0 outline-none resize-none max-h-32 min-h-[44px] py-3 px-2 text-white placeholder:text-zinc-600"
                                    placeholder={activeChatPartnerId === 'ALL' && currentUser.role !== Role.ADMIN ? 'Sadece yöneticiler duyuru yapabilir.' : t('msg.write')}
                                    readOnly={activeChatPartnerId === 'ALL' && currentUser.role !== Role.ADMIN}
                                    rows={1}
                                />
                                {!(activeChatPartnerId === 'ALL' && currentUser.role !== Role.ADMIN) && (
                                    <button 
                                        onClick={handleSendReply}
                                        disabled={isSending || !replyText.trim()}
                                        className="mb-1 p-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl transition-colors shadow-lg"
                                    >
                                        {isSending ? <Loader2 className="animate-spin" size={18}/> : <Send size={18} />}
                                    </button>
                                )}
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="h-full hidden md:flex flex-col items-center justify-center text-zinc-500">
                        <MessageSquare size={48} className="opacity-20 mb-4" />
                        <p>{t('msg.select')}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Messages;