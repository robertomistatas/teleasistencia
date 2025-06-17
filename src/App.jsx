import React, { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged,
    signInAnonymously,
    deleteUser
} from 'firebase/auth';
import { 
    getFirestore, 
    collection, 
    doc, 
    addDoc, 
    setDoc, 
    getDocs, 
    updateDoc, 
    deleteDoc,
    query,
    where,
    Timestamp,
    writeBatch
} from 'firebase/firestore';
import { getAnalytics } from 'firebase/analytics';
import CallDataAnalyzer from './components/CallDataAnalyzer';
import Logo from './components/Logo';
import AssignmentManager from './components/AssignmentManager';
import Dashboard from './components/Dashboard';
import FollowUpHistory from './components/FollowUpHistory';

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyASPhkFj4RwmmloxSgJzK3JhXD7-qz2yxk",
    authDomain: "teleasistencia-6c0fd.firebaseapp.com",
    projectId: "teleasistencia-6c0fd",
    storageBucket: "teleasistencia-6c0fd.firebasestorage.app",
    messagingSenderId: "551971576400",
    appId: "1:551971576400:web:952333e1409c2ecdaf8f55",
    measurementId: "G-4Z9KWG6JJS"
};

// Firebase Initialization
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
export const db = getFirestore(app);

// Contexto para autenticación
export const AuthContext = createContext();

// Contexto para datos
export const DataContext = createContext();

// Proveedor de autenticación
export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            setUser(user);
            setLoading(false);
        });

        return unsubscribe;
    }, []);

    const value = {
        user,
        loading,
        signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
        signOut: () => signOut(auth)
    };

    return (
        <AuthContext.Provider value={value}>
            {!loading && children}
        </AuthContext.Provider>
    );
}

// Hook personalizado para usar la autenticación
export function useAuth() {
    return useContext(AuthContext);
}

// Proveedor de datos
function DataProvider({ children }) {
    const [callData, setCallData] = useState({
        totalLlamados: 0,
        tiempoTotal: 0,
        cobertura: 0,
        llamadosPorOperadora: {},
        rendimientoPorOperadora: {},
        beneficiariosAtendidos: new Set(),
        detallesLlamadas: []
    });

    const [assignments, setAssignments] = useState({
        asignaciones: {},
        loading: true,
        error: null
    });

    // Cargar asignaciones al montar el componente
    useEffect(() => {
        const loadAssignments = async () => {
            try {
                const asignacionesQuery = query(collection(db, 'asignaciones'));
                const querySnapshot = await getDocs(asignacionesQuery);
                
                const asignacionesPorOperadora = {};
                
                querySnapshot.forEach((doc) => {
                    const data = doc.data();
                    if (data.teleoperadora && data.beneficiario) {
                        if (!asignacionesPorOperadora[data.teleoperadora]) {
                            asignacionesPorOperadora[data.teleoperadora] = [];
                        }
                        asignacionesPorOperadora[data.teleoperadora].push({
                            id: doc.id,
                            beneficiario: data.beneficiario,
                            telefonos: data.telefonos || [],
                            ...data
                        });
                    }
                });

                console.log('Asignaciones cargadas:', asignacionesPorOperadora);
                
                setAssignments(prev => ({
                    ...prev,
                    asignaciones: asignacionesPorOperadora,
                    loading: false,
                    error: null
                }));
            } catch (error) {
                console.error('Error cargando asignaciones:', error);
                setAssignments(prev => ({
                    ...prev,
                    loading: false,
                    error: error.message
                }));
            }
        };

        loadAssignments();
    }, []);

    const updateAssignments = useCallback((newAssignments) => {
        console.log('Actualizando asignaciones:', newAssignments);
        setAssignments(prev => ({
            ...prev,
            asignaciones: newAssignments,
            loading: false,
            error: null
        }));
    }, []);

    const updateCallData = useCallback((newData) => {
        console.log('Actualizando datos de llamadas:', newData);
        setCallData(prev => ({
            ...prev,
            detallesLlamadas: newData
        }));
    }, []);

    const value = {
        callData,
        assignments,
        updateCallData,
        updateAssignments
    };

    return (
        <DataContext.Provider value={value}>
            {children}
        </DataContext.Provider>
    );
}

// Componente principal de la aplicación
function MainContent() {
    const { user, loading } = useAuth();
    const [activeTab, setActiveTab] = useState('dashboard');
    
    if (loading) {
        return <div>Cargando...</div>;
    }

    if (!user) {
        return <LoginForm />;
    }    return (
        <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
            <div className="flex flex-col h-screen">
                {/* Header */}
                <header className="bg-white shadow-md">
                    <div className="mx-auto max-w-7xl px-4 py-4">
                        <div className="flex justify-between items-center">
                            <div className="flex items-center">
                                <Logo className="h-8 w-auto" />
                                <h1 className="ml-3 text-xl font-semibold text-gray-900">Teleasistencia</h1>
                            </div>
                            <nav className="flex space-x-1">
                                <button 
                                    onClick={() => setActiveTab('dashboard')}
                                    className={`px-4 py-2 rounded-lg transition-colors duration-150 ${
                                        activeTab === 'dashboard' 
                                            ? 'bg-blue-500 text-white' 
                                            : 'text-gray-600 hover:bg-gray-100'
                                    }`}
                                >
                                    Dashboard
                                </button>
                                <button 
                                    onClick={() => setActiveTab('llamadas')}
                                    className={`px-4 py-2 rounded-lg transition-colors duration-150 ${
                                        activeTab === 'llamadas' 
                                            ? 'bg-blue-500 text-white' 
                                            : 'text-gray-600 hover:bg-gray-100'
                                    }`}
                                >
                                    Registro de Llamadas
                                </button>
                                <button 
                                    onClick={() => setActiveTab('asignaciones')}
                                    className={`px-4 py-2 rounded-lg transition-colors duration-150 ${
                                        activeTab === 'asignaciones' 
                                            ? 'bg-blue-500 text-white' 
                                            : 'text-gray-600 hover:bg-gray-100'
                                    }`}                                >
                                    Asignaciones
                                </button>
                                <button 
                                    onClick={() => setActiveTab('seguimiento')}
                                    className={`px-4 py-2 rounded-lg transition-colors duration-150 ${
                                        activeTab === 'seguimiento' 
                                            ? 'bg-blue-500 text-white' 
                                            : 'text-gray-600 hover:bg-gray-100'
                                    }`}
                                >
                                    Historial de Seguimientos
                                </button>
                            </nav>
                            <button 
                                onClick={() => auth.signOut()}
                                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors duration-150"
                            >
                                Cerrar Sesión
                            </button>
                        </div>
                    </div>
                </header>

                {/* Main content */}
                <main className="flex-1 overflow-y-auto bg-gray-50">
                    <div className="mx-auto max-w-7xl px-4 py-6">                        {activeTab === 'dashboard' && <Dashboard />}
                        {activeTab === 'llamadas' && <CallDataAnalyzer />}
                        {activeTab === 'asignaciones' && <AssignmentManager />}
                        {activeTab === 'seguimiento' && <FollowUpHistory />}
                    </div>
                </main>
            </div>
        </div>
    );
}

// Componente raíz de la aplicación
function App() {
    return (
        <AuthProvider>
            <DataProvider>
                <MainContent />
            </DataProvider>
        </AuthProvider>
    );
}

export default App;
