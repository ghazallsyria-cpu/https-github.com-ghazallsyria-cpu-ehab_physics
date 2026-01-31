import React, { useState, useEffect, Suspense, lazy } from 'react';
import { LiveSession, User } from '../types';
import { dbService } from '../services/db';
import { Video, Calendar, User as UserIcon, BookOpen, RefreshCw, AlertCircle, PlayCircle, ExternalLink, Youtube, X, BellRing } from 'lucide-react';

// Lazy load components
const ZoomMeeting = lazy(() => import('./ZoomMeeting'));
const YouTubePlayer = lazy(() => import('./YouTubePlayer'));

// Helper to extract video ID
const extractYoutubeId = (url: string): string | null => {
    if (!url) return null;
    const regExp = /^.*(?:(?:youtu\.be\/|v\/|vi\/|u\/\w\/|embed\/|shorts\/)|(?:(?:watch)?\?v(?:i)?=|\&v(?:i)?=))([^#\&\?]{11}).*/;
    const match = url.match(regExp);
    return (match && match[1]) ? match[1] : null;
};

interface LiveSessionsProps {
  user: User;
}

const LiveSessions: React.FC<LiveSessionsProps> = ({ user }) => {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [activeZoomSession, setActiveZoomSession] = useState<LiveSession | null>(null);
  const [activeYoutubeSession, setActiveYoutubeSession] = useState<LiveSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);

  useEffect(() => {
    setIsLoading(true);
    
    // Subscribe to sessions
    const unsubscribeSessions = dbService.subscribeToLiveSessions((allSessions) => {
        // Safe Sorting: Handle invalid dates (text inputs) by pushing them to the end
        const sortedSessions = allSessions.sort((a, b) => {
            const timeA = new Date(a.startTime).getTime();
            const timeB = new Date(b.startTime).getTime();
            const valA = isNaN(timeA) ? 9999999999999 : timeA;
            const valB = isNaN(timeB) ? 9999999999999 : timeB;
            return valA - valB;
        });
        setSessions(sortedSessions);
        setIsLoading(false);
    });
    
    // Subscribe to teachers for extra info (optional)
    const unsubscribeTeachers = dbService.subscribeToUsers((updatedTeachers) => {
        setTeachers(updatedTeachers);
    }, 'teacher');

    // Safety timeout
    const safetyTimeout = setTimeout(() => setIsLoading(false), 5000);

    return () => {
        unsubscribeSessions();
        unsubscribeTeachers();
        clearTimeout(safetyTimeout);
    };
  }, []);
  
  // Notification Logic
  useEffect(() => {
    const NOTIFICATION_WINDOW_MINUTES = 5;
    const checkUpcomingSessions = () => {
        const now = new Date().getTime();
        sessions.forEach(session => {
            if (session.status === 'upcoming') {
                const sessionTime = new Date(session.startTime).getTime();
                if (isNaN(sessionTime)) return;
                
                const diffInMinutes = (sessionTime - now) / 60000;
                const notifiedKey = `notified_${session.id}`;
                
                if (diffInMinutes > 0 && diffInMinutes <= NOTIFICATION_WINDOW_MINUTES && !sessionStorage.getItem(notifiedKey)) {
                    setToast({ title: '📢 جلسة على وشك البدء!', message: `"${session.title}" تبدأ خلال دقائق.` });
                    sessionStorage.setItem(notifiedKey, 'true');
                    setTimeout(() => setToast(null), 7000);
                }
            }
        });
    };
    const intervalId = setInterval(checkUpcomingSessions, 30000);
    return () => clearInterval(intervalId);
  }, [sessions]);

  // Robust Filtering Logic
  const filteredSessions = sessions.filter(session => {
    // 1. Grade Filtering
    // If targetGrades is missing or empty, assume it's for everyone.
    const targets = session.targetGrades || [];
    const isForEveryone = targets.length === 0;
    
    // Normalize user grade to string to avoid number/string mismatch
    const userGrade = String(user.grade);
    const isGradeMatch = isForEveryone || targets.some(t => String(t) === userGrade);

    // 2. Subscription Filtering
    const isPremiumSession = session.isPremium === true;
    const hasAccess = !isPremiumSession || user.subscription === 'premium' || user.role === 'admin' || user.role === 'teacher';

    return isGradeMatch && hasAccess;
  });

  const handleJoinClick = (session: LiveSession) => {
    if (session.status !== 'live') {
      alert('لم تبدأ هذه الجلسة بعد.');
      return;
    }
    if (session.platform === 'zoom') {
      setActiveZoomSession(session);
    } else if (session.platform === 'youtube' && session.streamUrl) {
      setActiveYoutubeSession(session);
    } else if (session.streamUrl) {
      window.open(session.streamUrl, '_blank', 'noopener,noreferrer');
    } else {
      alert('رابط البث غير متوفر.');
    }
  };

  if (activeYoutubeSession) {
    const videoId = extractYoutubeId(activeYoutubeSession.streamUrl);
    return (
        <div className="fixed inset-0 z-[2000] bg-black/90 backdrop-blur-xl flex flex-col items-center justify-center p-4" onClick={() => setActiveYoutubeSession(null)}>
            <div className="w-full max-w-4xl bg-[#0a1118] rounded-[40px] border border-white/10 overflow-hidden shadow-2xl animate-slideUp" onClick={e => e.stopPropagation()}>
                <header className="p-4 flex justify-between items-center bg-black/50">
                    <h3 className="text-sm font-bold text-white">{activeYoutubeSession.title}</h3>
                    <button onClick={() => setActiveYoutubeSession(null)} className="p-2 rounded-full bg-white/10 text-white hover:bg-red-500"><X size={16} /></button>
                </header>
                <div className="aspect-video bg-black">
                    {videoId ? (
                        <Suspense fallback={<div className="w-full h-full flex items-center justify-center text-white">جاري تحميل البث...</div>}>
                            <YouTubePlayer videoId={videoId} />
                        </Suspense>
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-red-400 font-bold p-8 text-center">رابط يوتيوب غير صالح</div>
                    )}
                </div>
            </div>
        </div>
    );
  }

  if (activeZoomSession) {
    return (
      <Suspense fallback={<div className="fixed inset-0 bg-black flex items-center justify-center text-white z-[500]"><RefreshCw className="animate-spin mb-4" /></div>}>
        <ZoomMeeting 
            meetingNumber={activeZoomSession.meetingId || ""} 
            passCode={activeZoomSession.passcode || ""} 
            userName={user.name} 
            userRole={user.role}
            directLink={activeZoomSession.streamUrl}
            onLeave={() => setActiveZoomSession(null)}
        />
      </Suspense>
    );
  }

  return (
    <div className="max-w-6xl mx-auto py-12 px-6 animate-fadeIn font-['Tajawal'] text-white">
      {toast && (
        <div className="fixed top-24 right-10 z-[2000] w-full max-w-sm animate-slideUp">
            <div className="glass-panel p-6 rounded-[30px] border-2 border-amber-500/30 bg-amber-500/10 flex items-start gap-4 shadow-2xl">
                <BellRing size={24} className="text-amber-400 animate-pulse" />
                <div>
                    <h4 className="font-black text-amber-400">{toast.title}</h4>
                    <p className="text-sm text-gray-300">{toast.message}</p>
                </div>
                <button onClick={() => setToast(null)} className="absolute top-4 left-4 text-gray-500 hover:text-white">&times;</button>
            </div>
        </div>
      )}

      <div className="mb-16 text-center">
        <h2 className="text-5xl font-black mb-4 tracking-tighter italic uppercase">الجلسات <span className="text-blue-400 text-glow">المباشرة</span></h2>
        <p className="text-gray-500 text-xl max-w-3xl mx-auto leading-relaxed">
          جدول حصص البث المباشر والمراجعات لصف <span className="text-white font-bold">{user.grade}</span>.
        </p>
      </div>

      <div className="border-t border-white/5 pt-12">
        {isLoading ? (
          <div className="py-32 text-center">
             <RefreshCw className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
             <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">جاري تحديث الجدول...</p>
          </div>
        ) : filteredSessions.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {filteredSessions.map(session => {
                const teacher = teachers.find(t => t.name === session.teacherName);
                const isOnline = teacher?.lastSeen && (new Date().getTime() - new Date(teacher.lastSeen).getTime()) < 3 * 60 * 1000;
                
                return (
                  <div key={session.id} className={`bg-[#0a1118]/80 border p-8 rounded-[40px] group transition-all flex flex-col relative overflow-hidden ${session.status === 'live' ? 'border-blue-500/40 shadow-[0_0_30px_rgba(59,130,246,0.1)]' : 'border-white/5 hover:border-white/10'}`}>
                      <div className="flex justify-between items-start mb-6">
                          <span className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest ${session.status === 'live' ? 'bg-red-500 text-white animate-pulse' : 'bg-white/10 text-gray-400'}`}>
                              {session.status === 'live' ? 'بث مباشر 🔴' : 'مجدولة 📅'}
                          </span>
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-white/5 text-gray-500">
                              {session.platform === 'youtube' ? <Youtube size={20}/> : <Video size={20}/>}
                          </div>
                      </div>
                      
                      <div className="flex-1">
                          <h4 className="text-xl font-bold text-white mb-2 group-hover:text-blue-400 transition-colors">{session.title}</h4>
                          <div className="text-xs text-gray-500 font-bold mb-6 flex items-center gap-2">
                            <UserIcon size={14}/> {session.teacherName}
                            {isOnline && <span className="w-2 h-2 rounded-full bg-green-500" title="المعلم متصل"></span>}
                          </div>
                          <div className="space-y-2 mb-6">
                              <div className="flex items-center gap-2 text-[10px] text-gray-400"><BookOpen size={12}/> {session.topic}</div>
                              <div className="flex items-center gap-2 text-[10px] text-gray-400"><Calendar size={12}/> {session.startTime}</div>
                          </div>
                      </div>

                      {session.status === 'live' ? (
                          <div className="flex flex-col gap-2">
                            {session.platform === 'zoom' ? (
                                <button onClick={() => setActiveZoomSession(session)} className="w-full py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest bg-blue-500 text-white shadow-lg hover:scale-[1.02] transition-all flex items-center justify-center gap-3">
                                    <PlayCircle size={16}/> دخول الحصة الآن
                                </button>
                            ) : (
                                <button onClick={() => handleJoinClick(session)} className="w-full py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest bg-red-600 text-white shadow-lg hover:scale-[1.02] transition-all flex items-center justify-center gap-3">
                                    <Youtube size={16}/> مشاهدة البث
                                </button>
                            )}
                          </div>
                      ) : (
                          <button disabled className="w-full py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest bg-white/5 text-gray-600 cursor-not-allowed">
                              ستبدأ قريباً
                          </button>
                      )}
                  </div>
                );
              })}
          </div>
        ) : (
          <div className="py-32 text-center glass-panel rounded-[50px] border-2 border-dashed border-white/10 opacity-60">
              <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6">
                <Video size={40} className="text-gray-600" />
              </div>
              <p className="font-black text-lg uppercase tracking-widest mb-2">لا توجد حصص متاحة لصفك حالياً</p>
              <p className="text-sm text-gray-600 max-w-xs mx-auto">تأكد من أنك مشترك في الصف الصحيح ({user.grade}) أو انتظر إشعاراً من المعلم.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default LiveSessions;