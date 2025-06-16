import React, { useState, useEffect, createContext, useContext } from 'react';
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
        operadoras: [],
        asignaciones: {},
        totalBeneficiarios: 0
    });

    const updateCallData = (newData) => {
        const beneficiariosSet = new Set(newData.map(call => call.beneficiario));
        const llamadosPorOp = {};
        const rendimientoPorOp = {};
        
        assignments.operadoras.forEach(op => {
            const llamadosOp = newData.filter(call => {
                const beneficiario = call.beneficiario.toLowerCase();
                return assignments.asignaciones[op.nombre]?.some(
                    asig => asig.beneficiario.toLowerCase() === beneficiario
                );
            });

            llamadosPorOp[op.nombre] = llamadosOp.length;
            rendimientoPorOp[op.nombre] = {
                llamados: llamadosOp.length,
                minutos: Math.round(llamadosOp.reduce((acc, call) => acc + call.segundos, 0) / 60)
            };
        });

        const cobertura = assignments.totalBeneficiarios > 0 
            ? (beneficiariosSet.size / assignments.totalBeneficiarios * 100).toFixed(1)
            : 0;

        setCallData({
            totalLlamados: newData.length,
            tiempoTotal: Math.round(newData.reduce((acc, call) => acc + call.segundos, 0) / 60),
            cobertura,
            llamadosPorOperadora: llamadosPorOp,
            rendimientoPorOperadora: rendimientoPorOp,
            beneficiariosAtendidos: beneficiariosSet,
            detallesLlamadas: newData
        });
    };

    const updateAssignments = (data) => {
        if (!data || !data.asignaciones) {
            console.log('No hay datos de asignaciones para actualizar');
            return;
        }

        const totalBeneficiarios = Object.values(data.asignaciones)
            .reduce((acc, curr) => acc + (curr.beneficiarios?.length || 0), 0);

        setAssignments({
            operadoras: data.operadoras || [],
            asignaciones: data.asignaciones || {},
            totalBeneficiarios: data.totalBeneficiarios || totalBeneficiarios || 0
        });
    };

    return (
        <DataContext.Provider value={{
            callData,
            assignments,
            updateCallData,
            updateAssignments
        }}>
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
                                    }`}
                                >
                                    Asignaciones
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
                    <div className="mx-auto max-w-7xl px-4 py-6">
                        {activeTab === 'dashboard' && <Dashboard />}
                        {activeTab === 'llamadas' && <CallDataAnalyzer />}
                        {activeTab === 'asignaciones' && <AssignmentManager />}
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
