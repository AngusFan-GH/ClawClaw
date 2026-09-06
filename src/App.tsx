import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Toaster } from './components/Toaster';
import ChatPage from './pages/Chat';
import ProvidersPage from './pages/Providers';
import AgentsPage from './pages/Agents';
import SkillsPage from './pages/Skills';
import ChannelsPage from './pages/Channels';
import CronPage from './pages/Cron';
import SettingsPage from './pages/Settings';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ChatPage />} />
        <Route path="/models" element={<ProvidersPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/skills" element={<SkillsPage />} />
        <Route path="/channels" element={<ChannelsPage />} />
        <Route path="/cron" element={<CronPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
      <Toaster />
    </Layout>
  );
}
