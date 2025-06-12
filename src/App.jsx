// App.jsx
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
import CallDataAnalyzer from './components/CallDataAnalyzer';
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
import { read, utils } from 'xlsx';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { ArrowUpOnSquareIcon, UserPlusIcon, ArrowPathIcon, TrashIcon, PencilIcon, DocumentArrowUpIcon, ChartBarIcon, UsersIcon, PhoneIcon, ChevronDownIcon, LinkIcon } from '@heroicons/react/24/outline';
import AssignmentManager from './components/AssignmentManager';

// --- Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyASPhkFj4RwmmloxSgJzK3JhXD7-qz2yxk",
    authDomain: "teleasistencia-6c0fd.firebaseapp.com",
    projectId: "teleasistencia-6c0fd",
    storageBucket: "teleasistencia-6c0fd.firebasestorage.app",
    messagingSenderId: "551971576400",
    appId: "1:551971576400:web:952333e1409c2ecdaf8f55",
    measurementId: "G-4Z9KWG6JJS"
};

// --- Firebase Initialization ---
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);

// Export db instance for components to use
export { db };

// --- Authentication Context ---
const AuthContext = createContext();

const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            setUser(user);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const login = (email, password) => signInWithEmailAndPassword(auth, email, password);
    const register = (email, password) => createUserWithEmailAndPassword(auth, email, password);
    const logout = () => signOut(auth);

    const value = { user, login, register, logout, loading };

    return (
        <AuthContext.Provider value={value}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

const useAuth = () => {
    return useContext(AuthContext);
};


// --- Helper Components ---

const Spinner = () => (
    <div className="flex justify-center items-center h-full w-full">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500"></div>
    </div>
);

const Modal = ({ isOpen, onClose, title, children }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
                <div className="p-4 border-b flex justify-between items-center">
                    <h3 className="text-lg font-semibold">{title}</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800">&times;</button>
                </div>
                <div className="p-4">{children}</div>
            </div>
        </div>
    );
};

const Toast = ({ message, type, onDismiss }) => {
    const bgColor = type === 'success' ? 'bg-green-500' : 'bg-red-500';
    if (!message) return null;

    useEffect(() => {
        const timer = setTimeout(() => {
            onDismiss();
        }, 3000);
        return () => clearTimeout(timer);
    }, [message, onDismiss]);

    return (
        <div className={`fixed bottom-5 right-5 text-white px-6 py-3 rounded-lg shadow-lg ${bgColor}`}>
            {message}
        </div>
    );
};

// --- Main Application Components ---

const LoginPage = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await login(email, password);
        } catch (err) {
            setError('Error al iniciar sesión. Verifique sus credenciales.');
            console.error(err);
        }
        setLoading(false);
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-100">
            <div className="p-8 bg-white rounded-lg shadow-md w-full max-w-sm">
                <h2 className="text-2xl font-bold text-center text-gray-800 mb-6">Mistatas Call Center</h2>
                <form onSubmit={handleLogin}>
                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="email">Email</label>
                        <input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full px-3 py-2 border rounded-md text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            required
                        />
                    </div>
                    <div className="mb-6">
                        <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="password">Contraseña</label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full px-3 py-2 border rounded-md text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            required
                        />
                    </div>
                    {error && <p className="text-red-500 text-xs italic mb-4">{error}</p>}
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md focus:outline-none focus:shadow-outline disabled:bg-blue-300"
                    >
                        {loading ? 'Ingresando...' : 'Iniciar Sesión'}
                    </button>
                </form>
            </div>
        </div>
    );
};

const Sidebar = ({ setView }) => {
    const { logout } = useAuth();
    const navItems = [
        { name: 'Dashboard', icon: ChartBarIcon, view: 'dashboard' },
        { name: 'Teleoperadoras', icon: UsersIcon, view: 'operadoras' },
        { name: 'Beneficiarios', icon: PhoneIcon, view: 'beneficiarios' },
        { name: 'Asignaciones', icon: LinkIcon, view: 'assignments' },
        { name: 'Registro de Llamadas', icon: DocumentArrowUpIcon, view: 'cargar' },
    ];
    return (
        <div className="w-64 bg-gray-800 text-white flex flex-col min-h-screen">
            <div className="p-5 text-2xl font-bold border-b border-gray-700">Mistatas</div>
            <nav className="flex-grow">
                {navItems.map(item => (
                    <button key={item.name} onClick={() => setView(item.view)} className="w-full text-left flex items-center px-4 py-3 hover:bg-gray-700">
                       <item.icon className="h-6 w-6 mr-3" /> 
                       {item.name}
                    </button>
                ))}
            </nav>
            <div className="p-5 border-t border-gray-700">
                <button onClick={logout} className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded">
                    Cerrar Sesión
                </button>
            </div>
        </div>
    );
};

const Dashboard = () => {
    const [llamados, setLlamados] = useState([]);
    const [operadoras, setOperadoras] = useState([]);
    const [beneficiarios, setBeneficiarios] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState({
        startDate: '',
        endDate: '',
        teleoperadoraId: 'all',
        comuna: 'all',
        tipoLlamada: 'all'
    });
    
    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            const llamadosSnap = await getDocs(collection(db, `llamados`));
            setLlamados(llamadosSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            
            const operadorasSnap = await getDocs(collection(db, `users`));
            setOperadoras(operadorasSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

            const beneficiariosSnap = await getDocs(collection(db, `beneficiarios`));
            setBeneficiarios(beneficiariosSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

            setLoading(false);
        };
        fetchData();
    }, []);

    const handleFilterChange = (e) => {
        setFilters({ ...filters, [e.target.name]: e.target.value });
    };

    const filteredLlamados = React.useMemo(() => {
        return llamados.filter(l => {
            if (!l.fecha || typeof l.fecha.toDate !== 'function') return false; // Guard against invalid data
            const fechaLlamado = l.fecha.toDate();
            const startDate = filters.startDate ? new Date(filters.startDate) : null;
            const endDate = filters.endDate ? new Date(filters.endDate) : null;

            if (startDate && fechaLlamado < startDate) return false;
            if (endDate && fechaLlamado > endDate) return false;
            if (filters.teleoperadoraId !== 'all' && l.teleoperadoraId !== filters.teleoperadoraId) return false;
            if (filters.tipoLlamada !== 'all' && l.tipo !== filters.tipoLlamada) return false;
            
            if (filters.comuna !== 'all') {
                const beneficiario = beneficiarios.find(b => b.id === l.beneficiarioId);
                if (!beneficiario || beneficiario.comuna !== filters.comuna) return false;
            }
            
            return true;
        });
    }, [llamados, filters, beneficiarios]);

    const statsPorOperadora = React.useMemo(() => {
        const stats = operadoras.map(op => ({
            id: op.id,
            nombre: op.nombre,
            totalLlamados: 0,
            totalSegundos: 0,
        }));

        filteredLlamados.forEach(l => {
            const stat = stats.find(s => s.id === l.teleoperadoraId);
            if(stat) {
                stat.totalLlamados += 1;
                stat.totalSegundos += l.segundos;
            }
        });
        return stats;
    }, [filteredLlamados, operadoras]);
    
    const comunas = [...new Set(beneficiarios.map(b => b.comuna))];

    if (loading) return <Spinner />;

    return (
        <div className="p-6 bg-gray-50 min-h-full">
            <h1 className="text-3xl font-bold text-gray-800 mb-6">Dashboard de Análisis</h1>
            
            {/* --- Filtros --- */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6 p-4 bg-white rounded-lg shadow">
                <input type="date" name="startDate" value={filters.startDate} onChange={handleFilterChange} className="p-2 border rounded"/>
                <input type="date" name="endDate" value={filters.endDate} onChange={handleFilterChange} className="p-2 border rounded"/>
                <select name="teleoperadoraId" value={filters.teleoperadoraId} onChange={handleFilterChange} className="p-2 border rounded">
                    <option value="all">Todas las operadoras</option>
                    {operadoras.map(op => <option key={op.id} value={op.id}>{op.nombre}</option>)}
                </select>
                <select name="comuna" value={filters.comuna} onChange={handleFilterChange} className="p-2 border rounded">
                    <option value="all">Todas las comunas</option>
                    {comunas.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select name="tipoLlamada" value={filters.tipoLlamada} onChange={handleFilterChange} className="p-2 border rounded">
                    <option value="all">Todos los tipos</option>
                    <option value="entrante">Entrante</option>
                    <option value="saliente">Saliente</option>
                </select>
            </div>
            
            {/* --- KPIs --- */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="bg-white p-6 rounded-lg shadow">
                    <h3 className="text-lg font-semibold text-gray-600">Total Llamados</h3>
                    <p className="text-3xl font-bold">{filteredLlamados.length}</p>
                </div>
                <div className="bg-white p-6 rounded-lg shadow">
                    <h3 className="text-lg font-semibold text-gray-600">Tiempo Total (min)</h3>
                    <p className="text-3xl font-bold">{Math.round(filteredLlamados.reduce((acc, l) => acc + l.segundos, 0) / 60)}</p>
                </div>
                <div className="bg-white p-6 rounded-lg shadow">
                     <h3 className="text-lg font-semibold text-gray-600">Cobertura</h3>
                     <p className="text-3xl font-bold">
                        {beneficiarios.length > 0 ? 
                            `${Math.round(
                                ([...new Set(filteredLlamados.map(l => l.beneficiarioId))].length / beneficiarios.length) * 100
                            )}%` 
                        : '0%'}
                    </p>
                </div>
            </div>

            {/* --- Gráfico y Tabla --- */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-lg shadow">
                    <h3 className="text-xl font-semibold mb-4">Llamados por Teleoperadora</h3>
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={statsPorOperadora}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="nombre" />
                            <YAxis />
                            <Tooltip />
                            <Legend />
                            <Bar dataKey="totalLlamados" fill="#8884d8" name="Total de Llamados" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
                <div className="bg-white p-6 rounded-lg shadow">
                    <h3 className="text-xl font-semibold mb-4">Rendimiento por Teleoperadora</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-gray-500">
                             <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                                <tr>
                                    <th scope="col" className="px-6 py-3">Operadora</th>
                                    <th scope="col" className="px-6 py-3">Llamados</th>
                                    <th scope="col" className="px-6 py-3">Minutos</th>
                                    <th scope="col" className="px-6 py-3">Promedio (s)</th>
                                </tr>
                            </thead>
                            <tbody>
                               {statsPorOperadora.map(stat => (
                                    <tr key={stat.id} className="bg-white border-b">
                                        <td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">{stat.nombre}</td>
                                        <td className="px-6 py-4">{stat.totalLlamados}</td>
                                        <td className="px-6 py-4">{Math.round(stat.totalSegundos / 60)}</td>
                                        <td className="px-6 py-4">{stat.totalLlamados > 0 ? Math.round(stat.totalSegundos / stat.totalLlamados) : 0}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};


const Operadoras = () => {
    const [operadoras, setOperadoras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentOperadora, setCurrentOperadora] = useState(null);
    const [formData, setFormData] = useState({ nombre: '', email: '', password: '' });
    const [toast, setToast] = useState({ message: '', type: ''});
    const { register } = useAuth();
    
    const fetchOperadoras = async () => {
        setLoading(true);
        const usersCollection = collection(db, 'users');
        const userSnapshot = await getDocs(usersCollection);
        const userList = userSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setOperadoras(userList);
        setLoading(false);
    };

    useEffect(() => {
        // Cargar datos iniciales si la colección está vacía
        const initialSetup = async () => {
            const usersCollection = collection(db, 'users');
            const userSnapshot = await getDocs(usersCollection);
            if (userSnapshot.empty) {
                const initialOperators = [
                    { nombre: 'Roberto Mistatas', email: 'roberto@mistatas.com' },
                    { nombre: 'Ana Maria Asencio', email: 'ana.asencio@example.com' },
                    { nombre: 'Catalina Aguilera', email: 'catalina.aguilera@example.com' },
                    { nombre: 'Daniela Carmona', email: 'daniela.carmona@example.com' },
                    { nombre: 'Antonella Valdebenito', email: 'antonella.valdebenito@example.com' }
                ];

                for (const op of initialOperators) {
                    try {
                        const userCredential = await register(op.email, 'password123'); // Default password
                        await setDoc(doc(db, 'users', userCredential.user.uid), {
                            nombre: op.nombre,
                            email: op.email
                        });
                    } catch(error) {
                        console.error("Error creating initial user:", error);
                        // Don't set toast here as it's a background setup
                    }
                }
            }
           fetchOperadoras();
        };

        initialSetup();
    }, [register]);


    const handleOpenModal = (operadora = null) => {
        setCurrentOperadora(operadora);
        setFormData(operadora ? { nombre: operadora.nombre, email: operadora.email } : { nombre: '', email: '', password: '' });
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setCurrentOperadora(null);
    };

    const handleFormChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            if (currentOperadora) { // Editar
                await updateDoc(doc(db, 'users', currentOperadora.id), {
                    nombre: formData.nombre
                    // No se actualiza email/pass para simplificar
                });
                setToast({message: 'Operadora actualizada con éxito', type: 'success'});
            } else { // Crear
                const userCredential = await register(formData.email, formData.password);
                await setDoc(doc(db, 'users', userCredential.user.uid), {
                    nombre: formData.nombre,
                    email: formData.email,
                });
                setToast({message: 'Operadora creada con éxito', type: 'success'});
            }
            fetchOperadoras();
            handleCloseModal();
        } catch (error) {
            console.error("Error saving operator:", error);
            setToast({message: `Error: ${error.message}`, type: 'error'});
        }
    };
    
    const handleDelete = async (operadoraId) => {
      // Use a custom modal for confirmation instead of window.confirm
      // For simplicity, this example will keep window.confirm, but a modal is recommended.
      if (window.confirm('¿Estás seguro de que quieres eliminar esta operadora? Esta acción no se puede deshacer.')) {
        try {
          // This is complex because deleting a user from Auth requires re-authentication.
          // For this app, we'll just delete the Firestore record.
          // A full implementation would need a cloud function to handle Auth deletion.
          await deleteDoc(doc(db, 'users', operadoraId));
          setToast({message: 'Operadora eliminada (solo de la base de datos)', type: 'success'});
          fetchOperadoras();
        } catch(error){
          console.error("Error deleting operator:", error);
          setToast({message: `Error al eliminar: ${error.message}`, type: 'error'});
        }
      }
    };

    if (loading) return <Spinner />;

    return (
        <div className="p-6 bg-gray-50 min-h-full">
            <Toast message={toast.message} type={toast.type} onDismiss={() => setToast({message: '', type: ''})} />
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-gray-800">Gestión de Teleoperadoras</h1>
                <button onClick={() => handleOpenModal()} className="bg-blue-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-600">
                    <UserPlusIcon className="h-5 w-5"/> Nueva Operadora
                </button>
            </div>
            <div className="bg-white p-4 rounded-lg shadow">
                 <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-gray-500">
                        <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                            <tr>
                                <th scope="col" className="px-6 py-3">Nombre</th>
                                <th scope="col" className="px-6 py-3">Email</th>
                                <th scope="col" className="px-6 py-3">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {operadoras.map(op => (
                                <tr key={op.id} className="bg-white border-b">
                                    <td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">{op.nombre}</td>
                                    <td className="px-6 py-4">{op.email}</td>
                                    <td className="px-6 py-4 flex gap-2">
                                        <button onClick={() => handleOpenModal(op)} className="text-blue-600 hover:text-blue-900"><PencilIcon className="h-5 w-5"/></button>
                                        <button onClick={() => handleDelete(op.id)} className="text-red-600 hover:text-red-900"><TrashIcon className="h-5 w-5"/></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
             <Modal isOpen={isModalOpen} onClose={handleCloseModal} title={currentOperadora ? 'Editar Operadora' : 'Nueva Operadora'}>
                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label className="block text-gray-700">Nombre</label>
                        <input type="text" name="nombre" value={formData.nombre} onChange={handleFormChange} className="w-full p-2 border rounded" required />
                    </div>
                    <div className="mb-4">
                        <label className="block text-gray-700">Email</label>
                        <input type="email" name="email" value={formData.email} onChange={handleFormChange} className="w-full p-2 border rounded" required disabled={!!currentOperadora} />
                    </div>
                    {!currentOperadora && (
                         <div className="mb-4">
                            <label className="block text-gray-700">Contraseña</label>
                            <input type="password" name="password" value={formData.password} onChange={handleFormChange} className="w-full p-2 border rounded" required />
                        </div>
                    )}
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={handleCloseModal} className="px-4 py-2 bg-gray-300 rounded">Cancelar</button>
                        <button type="submit" className="px-4 py-2 bg-blue-500 text-white rounded">Guardar</button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

const Beneficiarios = () => {
    // CRUD implementation for Beneficiarios. Similar structure to Operadoras component.
    // This is left as an exercise to keep the code concise but would follow the same pattern:
    // 1. useState for beneficiarios, loading, modal, form data.
    // 2. useEffect to fetch data from `beneficiarios` collection.
    // 3. Functions to handle open/close modal, form changes, submit (add/edit), delete.
    // 4. A table to display beneficiaries and action buttons.
    // 5. A modal with a form for creating/editing beneficiaries (nombre, comuna, telefonos as a comma-separated string).
    return (
      <div className="p-6 bg-gray-50 min-h-full">
        <h1 className="text-3xl font-bold text-gray-800 mb-6">Gestión de Beneficiarios</h1>
        <div className="bg-white p-6 rounded-lg shadow text-center">
            <p className="text-gray-600">La funcionalidad CRUD para beneficiarios seguiría el mismo patrón que la gestión de Teleoperadoras.</p>
            <p className="mt-2 text-sm text-gray-500">Implica crear un formulario en un modal para añadir/editar nombre, comuna y teléfonos, y conectarlo a la colección 'beneficiarios' en Firestore.</p>
        </div>
      </div>
    );
};

const CargarDatos = () => {
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [toast, setToast] = useState({ message: '', type: '' });
    const [operadoras, setOperadoras] = useState([]);
    const [selectedOperadora, setSelectedOperadora] = useState('');
    const [existingAssignments, setExistingAssignments] = useState([]);
    const [isReassignModalOpen, setIsReassignModalOpen] = useState(false);
    const [selectedBeneficiary, setSelectedBeneficiary] = useState(null);
    const [newOperadora, setNewOperadora] = useState('');

    useEffect(() => {
        const fetchInitialData = async () => {
            try {
                // Fetch teleoperators
                const operadorasSnap = await getDocs(collection(db, 'users'));
                setOperadoras(operadorasSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

                // Fetch existing assignments
                const assignmentsSnap = await getDocs(collection(db, 'assignments'));
                setExistingAssignments(assignmentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            } catch (error) {
                console.error("Error fetching data:", error);
                setToast({ message: `Error al cargar datos: ${error.message}`, type: 'error' });
            }
        };
        fetchInitialData();
    }, []);

    const handleFileChange = (e) => {
        setFile(e.target.files[0]);
    };

    const handleOperadoraChange = (e) => {
        setSelectedOperadora(e.target.value);
    };

    const handleFileUpload = async () => {
        if (!file || !selectedOperadora) {
            setToast({ message: 'Por favor, selecciona una operadora y un archivo', type: 'error' });
            return;
        }

        setLoading(true);
        const reader = new FileReader();
        
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const json = utils.sheet_to_json(worksheet);

                const operadora = operadoras.find(op => op.id === selectedOperadora);
                const batch = writeBatch(db);
                
                // Track new beneficiarios to avoid duplicates
                const processedBeneficiarios = new Map();

                for (const row of json) {
                    const beneficiarioName = row['Nombre']; // Assuming 'Nombre' is the column header
                    const telefonos = String(row['Telefonos']).split(',').map(tel => tel.trim());
                    const comuna = row['Comuna'];

                    if (!beneficiarioName) continue;

                    // Check if beneficiary already exists in assignments
                    const existingAssignment = existingAssignments.find(a => 
                        a.beneficiarioNombre.toLowerCase() === beneficiarioName.toLowerCase()
                    );

                    if (existingAssignment) {
                        // Skip if already assigned to this operadora
                        if (existingAssignment.operadoraId === selectedOperadora) {
                            continue;
                        }
                        // Update existing assignment
                        batch.update(doc(db, 'assignments', existingAssignment.id), {
                            operadoraId: operadora.id,
                            operadoraNombre: operadora.nombre
                        });
                    } else {
                        // Create new beneficiary if not processed in this batch
                        let beneficiarioId = processedBeneficiarios.get(beneficiarioName);
                        
                        if (!beneficiarioId) {
                            const beneficiarioRef = doc(collection(db, 'beneficiarios'));
                            beneficiarioId = beneficiarioRef.id;
                            batch.set(beneficiarioRef, {
                                nombre: beneficiarioName,
                                comuna: comuna,
                                telefonos: telefonos
                            });
                            processedBeneficiarios.set(beneficiarioName, beneficiarioId);
                        }

                        // Create new assignment
                        const assignmentRef = doc(collection(db, 'assignments'));
                        batch.set(assignmentRef, {
                            beneficiarioId: beneficiarioId,
                            beneficiarioNombre: beneficiarioName,
                            operadoraId: operadora.id,
                            operadoraNombre: operadora.nombre,
                            createdAt: new Date()
                        });
                    }
                }

                await batch.commit();
                
                // Refresh assignments list
                const newAssignmentsSnap = await getDocs(collection(db, 'assignments'));
                setExistingAssignments(newAssignmentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                
                setToast({ message: `Se procesaron ${json.length} registros exitosamente`, type: 'success' });
            } catch (error) {
                console.error("Error processing file:", error);
                setToast({ message: `Error al procesar archivo: ${error.message}`, type: 'error' });
            } finally {
                setLoading(false);
                setFile(null);
                if (document.getElementById('file-upload')) {
                    document.getElementById('file-upload').value = null;
                }
            }
        };

        reader.readAsArrayBuffer(file);
    };

    const handleReassignBeneficiary = async () => {
        if (!selectedBeneficiary || !newOperadora) {
            setToast({ message: 'Selecciona un beneficiario y una operadora', type: 'error' });
            return;
        }

        try {
            const operadora = operadoras.find(op => op.id === newOperadora);
            await updateDoc(doc(db, 'assignments', selectedBeneficiary.id), {
                operadoraId: operadora.id,
                operadoraNombre: operadora.nombre
            });

            // Refresh assignments list
            const newAssignmentsSnap = await getDocs(collection(db, 'assignments'));
            setExistingAssignments(newAssignmentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

            setToast({ message: 'Beneficiario reasignado exitosamente', type: 'success' });
            setIsReassignModalOpen(false);
            setSelectedBeneficiary(null);
            setNewOperadora('');
        } catch (error) {
            console.error("Error reassigning beneficiary:", error);
            setToast({ message: `Error al reasignar: ${error.message}`, type: 'error' });
        }
    };

    return (
        <div className="p-6 bg-gray-50 min-h-full">
            <Toast message={toast.message} type={toast.type} onDismiss={() => setToast({message: '', type: ''})} />
            
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-800 mb-6">Carga de Beneficiarios por Teleoperadora</h1>
                <div className="bg-white p-8 rounded-lg shadow max-w-xl mx-auto">
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Seleccionar Teleoperadora
                        </label>
                        <select
                            value={selectedOperadora}
                            onChange={handleOperadoraChange}
                            className="w-full p-2 border rounded-md mb-4"
                        >
                            <option value="">Seleccionar operadora</option>
                            {operadoras.map(op => (
                                <option key={op.id} value={op.id}>{op.nombre}</option>
                            ))}
                        </select>

                        <p className="text-gray-600 mb-4">
                            Sube un archivo Excel con los beneficiarios:
                            <br />
                            Columna A: Nombre del beneficiario
                            <br />
                            Columna B: Teléfonos (separados por comas)
                            <br />
                            Columna C: Comuna
                        </p>
                    </div>

                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                        <input
                            type="file"
                            id="file-upload"
                            accept=".xlsx,.xls"
                            onChange={handleFileChange}
                            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                        />
                    </div>

                    <button
                        onClick={handleFileUpload}
                        disabled={loading || !file || !selectedOperadora}
                        className="mt-6 w-full bg-blue-500 text-white px-4 py-3 rounded-lg flex items-center justify-center gap-2 hover:bg-blue-600 disabled:bg-gray-400"
                    >
                        {loading ? <ArrowPathIcon className="h-5 w-5 animate-spin"/> : <ArrowUpOnSquareIcon className="h-5 w-5"/>}
                        {loading ? 'Procesando...' : 'Subir y Procesar'}
                    </button>
                </div>
            </div>

            <div className="mt-8">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">Asignaciones Actuales</h2>
                <div className="bg-white rounded-lg shadow overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Beneficiario</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Teleoperadora</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {existingAssignments.map(assignment => (
                                <tr key={assignment.id}>
                                    <td className="px-6 py-4">{assignment.beneficiarioNombre}</td>
                                    <td className="px-6 py-4">{assignment.operadoraNombre}</td>
                                    <td className="px-6 py-4">
                                        <button
                                            onClick={() => {
                                                setSelectedBeneficiary(assignment);
                                                setIsReassignModalOpen(true);
                                            }}
                                            className="text-blue-600 hover:text-blue-900"
                                        >
                                            Reasignar
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <Modal
                isOpen={isReassignModalOpen}
                onClose={() => {
                    setIsReassignModalOpen(false);
                    setSelectedBeneficiary(null);
                    setNewOperadora('');
                }}
                title="Reasignar Beneficiario"
            >
                <div className="p-4">
                    <p className="mb-4">
                        Reasignar a <strong>{selectedBeneficiary?.beneficiarioNombre}</strong>
                    </p>
                    <select
                        value={newOperadora}
                        onChange={(e) => setNewOperadora(e.target.value)}
                        className="w-full p-2 border rounded-md mb-4"
                    >
                        <option value="">Seleccionar nueva operadora</option>
                        {operadoras.map(op => (
                            <option key={op.id} value={op.id}>{op.nombre}</option>
                        ))}
                    </select>
                    <div className="flex justify-end gap-2">
                        <button
                            onClick={() => setIsReassignModalOpen(false)}
                            className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleReassignBeneficiary}
                            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                        >
                            Confirmar
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};


const MainLayout = () => {
    const [view, setView] = useState('dashboard'); // default view

    const renderView = () => {
        switch (view) {
            case 'dashboard':
                return <Dashboard />;
            case 'operadoras':
                return <Operadoras />;
            case 'beneficiarios':
                return <Beneficiarios />;
            case 'assignments':
                return <AssignmentManager />;
            case 'cargar':
                return <CallDataAnalyzer />;
            default:
                return <Dashboard />;
        }
    };

    return (
        <div className="flex">
            <Sidebar setView={setView} />
            <main className="flex-grow">
                {renderView()}
            </main>
        </div>
    );
};


export default function App() {
    return (
        <AuthProvider>
            <MainApp />
        </AuthProvider>
    );
}

const MainApp = () => {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="h-screen w-screen flex items-center justify-center">
                <Spinner />
            </div>
        );
    }

    return user ? <MainLayout /> : <LoginPage />;
}
