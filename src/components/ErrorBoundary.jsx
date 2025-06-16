import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error('Error in component:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded relative">
                    <strong className="font-bold">Ha ocurrido un error: </strong>
                    <span className="block sm:inline">{this.state.error.message}</span>
                    <button
                        onClick={() => this.setState({ hasError: false, error: null })}
                        className="mt-2 bg-red-100 text-red-700 px-3 py-1 rounded hover:bg-red-200"
                    >
                        Reintentar
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
