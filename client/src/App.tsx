import { HashRouter as Router, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Budget from './pages/Budget'
import Forecast from './pages/Forecast'
import History from './pages/History'
import Accounts from './pages/Accounts'
import Setup from './pages/Setup'

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/budget" element={<Budget />} />
          <Route path="/forecast" element={<Forecast />} />
          <Route path="/history" element={<History />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/setup" element={<Setup />} />
        </Routes>
      </Layout>
    </Router>
  )
}

export default App
