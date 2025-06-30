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
import LoginForm from './components/LoginForm';

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

// Estado inicial para el contexto de datos
const initialCallData = {
    totalLlamadas: 0,
    entrantes: 0,
    salientes: 0,
    duracionTotal: 0,
    duracionPromedio: 0,
    beneficiarios: [],
    llamadasPorBeneficiario: {},
    ultimasLlamadas: {},
    llamadasExitosas: {},
    beneficiariosAlDia: [],
    beneficiariosPendientes: [],
    beneficiariosUrgentes: [],
    comunas: {},
    teleoperadoras: {},
    lastUpdate: null
};

// Proveedor de datos
export function DataProvider({ children }) {
    const [callData, setCallData] = useState(() => {
        // Intentar cargar datos desde localStorage
        try {
            const saved = localStorage.getItem('callData');
            return saved ? JSON.parse(saved) : initialCallData;
        } catch (error) {
            console.error('Error loading data from localStorage:', error);
            return initialCallData;
        }
    });

    const [assignments, setAssignments] = useState(() => {
        // Intentar cargar asignaciones desde localStorage
        try {
            const saved = localStorage.getItem('assignments');
            return saved ? JSON.parse(saved) : { asignaciones: {} };
        } catch (error) {
            console.error('Error loading assignments from localStorage:', error);
            return { asignaciones: {} };
        }
    });

    useEffect(() => {
        // Cargar datos desde localStorage al iniciar
        try {
            const savedCallData = localStorage.getItem('callData');
            if (savedCallData) {
                setCallData(JSON.parse(savedCallData));
            }
        } catch (error) {
            console.error('Error al cargar datos desde localStorage:', error);
        }
    }, []);

    // Guardar datos en localStorage cuando cambien
    useEffect(() => {
        // Guardar datos en localStorage cuando cambien
        try {
            if (callData && Object.keys(callData).length > 0) {
                localStorage.setItem('callData', JSON.stringify(callData));
            }
        } catch (error) {
            console.error('Error guardando datos en localStorage:', error);
        }
    }, [callData]);

    // Guardar asignaciones en localStorage cuando cambien
    useEffect(() => {
        try {
            if (assignments && Object.keys(assignments).length > 0) {
                localStorage.setItem('assignments', JSON.stringify(assignments));
            }
        } catch (error) {
            console.error('Error guardando asignaciones:', error);
        }
    }, [assignments]);

    useEffect(() => {
        // Cargar datos desde Firestore al iniciar
        const fetchData = async () => {
            try {
                const docRef = doc(db, 'callData', 'latest');
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    setCallData(docSnap.data());
                } else {
                    console.log('No se encontraron datos en Firestore');
                }
            } catch (error) {
                console.error('Error al cargar datos desde Firestore:', error);
            }
        };
        fetchData();
    }, []);

    useEffect(() => {
        // Guardar datos en Firestore cuando cambien
        const saveData = async () => {
            try {
                if (callData && Object.keys(callData).length > 0) {
                    const docRef = doc(db, 'callData', 'latest');
                    await setDoc(docRef, callData);
                }
            } catch (error) {
                console.error('Error guardando datos en Firestore:', error);
            }
        };
        saveData();
    }, [callData]);

    // Función para actualizar datos
    const updateCallData = useCallback((newData) => {
        console.log('Actualizando datos de llamadas:', newData);
        setCallData(prevData => {
            // Asegurarse de que las estructuras de datos estén presentes
            const updatedData = {
                ...initialCallData,
                ...prevData,
                ...newData,
                lastUpdate: new Date().toISOString(),
                // Asegurar que las propiedades críticas existan
                llamadasPorBeneficiario: {
                    ...(prevData.llamadasPorBeneficiario || {}),
                    ...(newData.llamadasPorBeneficiario || {})
                },
                beneficiarios: Array.isArray(newData.beneficiarios) ? newData.beneficiarios : [],
                beneficiariosAlDia: Array.isArray(newData.beneficiariosAlDia) ? newData.beneficiariosAlDia : [],
                beneficiariosPendientes: Array.isArray(newData.beneficiariosPendientes) ? newData.beneficiariosPendientes : [],
                beneficiariosUrgentes: Array.isArray(newData.beneficiariosUrgentes) ? newData.beneficiariosUrgentes : []
            };
            return updatedData;
        });
    }, []);

    // Función para actualizar asignaciones
    const updateAssignments = useCallback((newAssignments) => {
        setAssignments(prev => ({
            ...prev,
            asignaciones: {
                ...(prev.asignaciones || {}),
                ...newAssignments
            }
        }));
    }, []);

    return (
        <DataContext.Provider value={{ 
            callData, 
            updateCallData, 
            assignments, 
            updateAssignments,
            reset: () => {
                setCallData(initialCallData);
                setAssignments({ asignaciones: {} });
                localStorage.removeItem('callData');
                localStorage.removeItem('assignments');
            }
        }}>
            {children}
        </DataContext.Provider>
    );
}

// Contexto del tema
export const ThemeContext = createContext();

// Proveedor del tema
export function ThemeProvider({ children }) {
    const [darkMode, setDarkMode] = useState(false);

    const toggleTheme = () => {
        setDarkMode(!darkMode);
        document.documentElement.classList.toggle('dark');
    };

    const value = {
        darkMode,
        toggleTheme
    };

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    );
}

// Hook personalizado para usar el tema
export function useTheme() {
    return useContext(ThemeContext);
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
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-200">
            <div className="flex flex-col h-screen">
                {/* Header */}
                <header className="bg-white dark:bg-gray-800 shadow-md">
                    <div className="responsive-container">
                        <div className="flex flex-col lg:flex-row justify-between items-center py-4 space-y-4 lg:space-y-0">
                            <div className="flex items-center w-full lg:w-auto justify-between">
                                <Logo />
                                <button 
                                    onClick={() => auth.signOut()}
                                    className="lg:hidden px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors duration-150"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V4a1 1 0 00-1-1H3zm11 4a1 1 0 11-2 0 1 1 0 012 0zm-8 0a1 1 0 11-2 0 1 1 0 012 0zm4 0a1 1 0 11-2 0 1 1 0 012 0z" clipRule="evenodd" />
                                    </svg>
                                </button>
                            </div>
                            
                            <nav className="flex flex-wrap justify-center gap-2 w-full lg:w-auto overflow-x-auto">
                                <button 
                                    onClick={() => setActiveTab('dashboard')}
                                    className={`px-4 py-2 rounded-lg transition-colors duration-150 whitespace-nowrap ${
                                        activeTab === 'dashboard' 
                                            ? 'bg-blue-500 text-white dark:bg-blue-600' 
                                            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                    }`}
                                >
                                    Dashboard
                                </button>
                                <button 
                                    onClick={() => setActiveTab('llamadas')}
                                    className={`px-4 py-2 rounded-lg transition-colors duration-150 whitespace-nowrap ${
                                        activeTab === 'llamadas' 
                                            ? 'bg-blue-500 text-white dark:bg-blue-600' 
                                            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                    }`}
                                >
                                    Registro de Llamadas
                                </button>
                                <button 
                                    onClick={() => setActiveTab('asignaciones')}
                                    className={`px-4 py-2 rounded-lg transition-colors duration-150 whitespace-nowrap ${
                                        activeTab === 'asignaciones' 
                                            ? 'bg-blue-500 text-white dark:bg-blue-600' 
                                            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                    }`}
                                >
                                    Asignaciones
                                </button>
                                <button 
                                    onClick={() => setActiveTab('seguimiento')}
                                    className={`px-4 py-2 rounded-lg transition-colors duration-150 whitespace-nowrap ${
                                        activeTab === 'seguimiento' 
                                            ? 'bg-blue-500 text-white dark:bg-blue-600' 
                                            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                    }`}
                                >
                                    Historial de Seguimientos
                                </button>
                            </nav>
                            
                            <button 
                                onClick={() => auth.signOut()}
                                className="hidden lg:block px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors duration-150"
                            >
                                Cerrar Sesión
                            </button>
                        </div>
                    </div>
                </header>
                {/* Version marker */}
                <div className="absolute top-4 right-4 text-sm text-gray-500 dark:text-gray-400">
                    Ver. 1.0.0
                </div>
                {/* Main content */}
                <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 transition-colors duration-200">
                    <div className="responsive-container py-6">
                        <div className="w-full overflow-x-hidden">
                            {activeTab === 'dashboard' && <Dashboard />}
                            {activeTab === 'llamadas' && <CallDataAnalyzer />}
                            {activeTab === 'asignaciones' && <AssignmentManager />}
                            {activeTab === 'seguimiento' && <FollowUpHistory />}
                        </div>
                    </div>
                </main>
                {/* Footer */}
                <footer className="bg-gray-100 dark:bg-gray-800 text-center py-4">
                    <p className="text-sm text-gray-500 dark:text-gray-400">Ver. 1.0.0</p>
                </footer>
            </div>
        </div>
    );
}

// Componente raíz de la aplicación
function App() {
    return (
        <ThemeProvider>
            <AuthProvider>
                <DataProvider>
                    <MainContent />
                </DataProvider>
            </AuthProvider>
        </ThemeProvider>
    );
}

export default App;
