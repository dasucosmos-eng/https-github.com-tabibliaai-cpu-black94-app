import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
  ScrollView,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../lib/firebase';
import { colors } from '../theme/colors';
import * as Salary from '../lib/salary';

/* ── Theme ──────────────────────────────────────────────────────────────────── */

const C = {
  ...colors,
  surface: colors.surface,
  surfaceBorder: colors.border,
  textPrimary: colors.text,
  textSecondary: colors.textSecondary,
  textTertiary: colors.textMuted,
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#06b6d4',
  purple: '#8b5cf6',
  blue: '#3b82f6',
  white: colors.white,
  gold: '#ffd700',
  black: '#000000',
};

const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };
const F = { xs: 10, sm: 12, md: 14, lg: 15, xl: 18, xxl: 22, xxxl: 28 };
const BR = { sm: 6, md: 10, lg: 16, xl: 24 };

const DEPARTMENTS = ['General', 'Sales', 'Marketing', 'Engineering', 'Operations', 'Finance', 'HR', 'Support'];

/* ── Helpers ──────────────────────────────────────────────────────────────────── */

function fmtPaise(paise: number): string {
  return '₹' + (paise / 100).toLocaleString('en-IN');
}

/* ── Component ─────────────────────────────────────────────────────────────── */

interface Props {
  navigation?: any;
}

const SalaryScreen: React.FC<Props> = () => {
  const uid = auth().currentUser?.uid ?? '';
  const [employees, setEmployees] = useState<Salary.Employee[]>([]);
  const [payrolls, setPayrolls] = useState<Salary.Payroll[]>([]);
  const [report, setReport] = useState<Salary.SalaryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Active payroll for detail view
  const [activePayroll, setActivePayroll] = useState<Salary.Payroll | null>(null);

  // Selected employee for detail modal
  const [selectedEmployee, setSelectedEmployee] = useState<Salary.Employee | null>(null);

  // Create employee modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [empName, setEmpName] = useState('');
  const [empEmail, setEmpEmail] = useState('');
  const [empPhone, setEmpPhone] = useState('');
  const [empRole, setEmpRole] = useState('');
  const [empDepartment, setEmpDepartment] = useState('General');
  const [empSalary, setEmpSalary] = useState('');
  const [creating, setCreating] = useState(false);

  // Generate payroll
  const [generating, setGenerating] = useState(false);

  /* ── Data Loading ── */

  const load = useCallback(async () => {
    try {
      const [empList, payrollList] = await Promise.all([
        Salary.fetchEmployees(uid),
        Salary.fetchPayrollHistory(uid),
      ]);
      setEmployees(empList);
      setPayrolls(payrollList);

      if (payrollList.length > 0 && !activePayroll) {
        setActivePayroll(payrollList[0]);
      }
    } catch (e) {
      console.error('[Salary] Failed:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  /* ── Handlers ── */

  const getCurrentMonth = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  };

  const handleGeneratePayroll = async (month: string) => {
    setGenerating(true);
    try {
      const payroll = await Salary.generatePayroll(uid, month);
      setPayrolls((prev) => {
        const exists = prev.find(p => p.month === month);
        if (exists) return prev.map(p => p.month === month ? payroll : p);
        return [payroll, ...prev];
      });
      setActivePayroll(payroll);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to generate payroll');
    } finally {
      setGenerating(false);
    }
  };

  const handleMarkPaid = async (payrollId: string, employeeId: string) => {
    try {
      await Salary.markSalaryPaid(payrollId, employeeId, {
        method: 'bank_transfer',
        transactionId: `PAY-${Date.now()}`,
        amount: 0,
        paidAt: new Date().toISOString(),
        processedBy: uid,
      });
      const refreshed = await Salary.fetchPayrollHistory(uid);
      setPayrolls(refreshed);
      const current = refreshed.find(p => p.id === payrollId);
      if (current) setActivePayroll(current);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to mark as paid');
    }
  };

  const handleCreateEmployee = async () => {
    if (!empName.trim()) { Alert.alert('Error', 'Name is required'); return; }
    setCreating(true);
    try {
      await Salary.addEmployee({
        businessId: uid,
        name: empName.trim(),
        email: empEmail.trim(),
        phone: empPhone.trim(),
        role: empRole.trim() || 'Team Member',
        department: empDepartment,
        salaryStructure: {
          baseSalary: Math.round((parseFloat(empSalary) || 0) * 100),
        },
      });
      setEmpName(''); setEmpEmail(''); setEmpPhone(''); setEmpRole(''); setEmpDepartment('General'); setEmpSalary('');
      setShowCreateModal(false);
      load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to add employee');
    } finally {
      setCreating(false);
    }
  };

  const handleLoadReport = async () => {
    if (!activePayroll) return;
    try {
      const r = await Salary.getSalaryReport(uid, activePayroll.month);
      setReport(r);
    } catch {
      // silent
    }
  };

  const handleRemoveEmployee = async (empId: string) => {
    Alert.alert('Remove Employee', 'This will mark the employee as inactive. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try {
          await Salary.removeEmployee(empId);
          load();
          setSelectedEmployee(null);
        } catch (e: any) {
          Alert.alert('Error', e?.message || 'Failed to remove employee');
        }
      }},
    ]);
  };

  /* ── Derived Stats ── */

  const activeEmployees = employees.filter(e => e.status === 'active');
  const totalBaseSalary = activeEmployees.reduce((s, e) => s + e.salaryStructure.baseSalary, 0);

  /* ── Render ── */

  if (loading) {
    return (
      <View style={styles.centerLoader}>
        <ActivityIndicator color={C.gold} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Ionicons name="cash-outline" size={22} color={C.gold} />
        <Text style={styles.headerTitle}>Salary & Payroll</Text>
        <TouchableOpacity style={styles.addEmpBtn} onPress={() => setShowCreateModal(true)}>
          <Ionicons name="person-add-outline" size={18} color={C.black} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.gold} />
      }>

        {/* ═══ Summary KPIs ═══ */}
        <View style={styles.section}>
          <View style={styles.kpiRow}>
            <View style={styles.kpiCard}>
              <Ionicons name="people-outline" size={18} color={C.gold} />
              <Text style={styles.kpiValue}>{activeEmployees.length}</Text>
              <Text style={styles.kpiLabel}>Active Employees</Text>
            </View>
            <View style={styles.kpiCard}>
              <Ionicons name="wallet-outline" size={18} color={C.success} />
              <Text style={styles.kpiValue}>{fmtPaise(totalBaseSalary)}</Text>
              <Text style={styles.kpiLabel}>Monthly Payroll</Text>
            </View>
            <View style={styles.kpiCard}>
              <Ionicons name="document-text-outline" size={18} color={C.info} />
              <Text style={styles.kpiValue}>{payrolls.length}</Text>
              <Text style={styles.kpiLabel}>Payroll Records</Text>
            </View>
          </View>
        </View>

        {/* ═══ Generate Payroll ═══ */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Generate Payroll</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.generateBtn}
              onPress={() => handleGeneratePayroll(getCurrentMonth())}
              disabled={generating}>
              {generating ? (
                <ActivityIndicator size="small" color={C.black} />
              ) : (
                <>
                  <Ionicons name="document-text-outline" size={18} color={C.black} />
                  <Text style={styles.generateBtnText}>
                    Generate for {new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                  </Text>
                </>
              )}
            </TouchableOpacity>
            <Text style={styles.generateHint}>
              Creates payroll entries for all active employees with their salary structure and performance bonuses.
            </Text>
          </View>
        </View>

        {/* ═══ Employee List ═══ */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Employees ({activeEmployees.length})</Text>
          {activeEmployees.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="people-outline" size={40} color={C.textTertiary} />
              <Text style={styles.emptyText}>No active employees. Add team members to manage payroll.</Text>
            </View>
          ) : (
            activeEmployees.map((emp) => {
              const gross = Salary.computeNetSalary(emp.salaryStructure);
              return (
                <TouchableOpacity
                  key={emp.id}
                  style={styles.empCard}
                  activeOpacity={0.7}
                  onPress={() => setSelectedEmployee(emp)}>
                  <View style={styles.empLeft}>
                    <View style={styles.empAvatar}>
                      <Text style={styles.empAvatarText}>{emp.name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={styles.empInfo}>
                      <Text style={styles.empName}>{emp.name}</Text>
                      <Text style={styles.empRole}>
                        {emp.role}
                        {emp.department !== 'General' ? ` · ${emp.department}` : ''}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.empRight}>
                    <Text style={styles.empSalary}>{fmtPaise(gross)}</Text>
                    <Text style={styles.empSalaryLabel}>Net/month</Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* ═══ Payroll History ═══ */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payroll History</Text>
          {payrolls.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="calendar-outline" size={40} color={C.textTertiary} />
              <Text style={styles.emptyText}>No payroll records. Generate your first payroll above.</Text>
            </View>
          ) : (
            payrolls.map((pr) => {
              const statusCfg: Record<string, { color: string; bg: string }> = {
                paid: { color: C.success, bg: 'rgba(34,197,94,0.15)' },
                partially_paid: { color: C.warning, bg: 'rgba(245,158,11,0.15)' },
                generated: { color: C.textSecondary, bg: 'rgba(113,118,123,0.15)' },
              };
              const stCfg = statusCfg[pr.status] || statusCfg.generated;
              const statusLabel = pr.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
              return (
                <TouchableOpacity
                  key={pr.id}
                  style={[styles.payrollCard, activePayroll?.id === pr.id && styles.payrollCardActive]}
                  onPress={() => { setActivePayroll(pr); setReport(null); }}>
                  <View style={styles.payrollLeft}>
                    <Text style={styles.payrollMonth}>{Salary.formatPayrollMonth(pr.month)}</Text>
                    <Text style={styles.payrollMeta}>
                      {pr.employeeCount} employees
                      {pr.paidCount < pr.employeeCount ? ` · ${pr.paidCount}/${pr.employeeCount} paid` : ''}
                    </Text>
                  </View>
                  <View style={styles.payrollRight}>
                    <Text style={styles.payrollTotal}>{fmtPaise(pr.totalNet)}</Text>
                    <View style={[styles.payrollStatusBadge, { backgroundColor: stCfg.bg }]}>
                      <Text style={[styles.payrollStatusText, { color: stCfg.color }]}>{statusLabel}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* ═══ Active Payroll Detail ═══ */}
        {activePayroll && activePayroll.entries.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>
                Payroll Detail — {Salary.formatPayrollMonth(activePayroll.month)}
              </Text>
              <TouchableOpacity style={styles.reportBtn} onPress={handleLoadReport}>
                <Ionicons name="bar-chart-outline" size={14} color={C.info} />
                <Text style={styles.reportBtnText}>Report</Text>
              </TouchableOpacity>
            </View>
            {activePayroll.entries.map((entry) => (
              <View key={entry.employeeId} style={styles.entryCard}>
                <View style={styles.entryLeft}>
                  <View style={styles.entryAvatar}>
                    <Text style={styles.entryAvatarText}>{entry.employeeName.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={styles.entryInfo}>
                    <Text style={styles.entryName}>{entry.employeeName}</Text>
                    <Text style={styles.entryRole}>{entry.role}</Text>
                    {entry.performanceBonus > 0 && (
                      <Text style={styles.entryBonus}>+{fmtPaise(entry.performanceBonus)} performance bonus</Text>
                    )}
                  </View>
                </View>
                <View style={styles.entryRight}>
                  <Text style={styles.entryNet}>{fmtPaise(entry.netSalary)}</Text>
                  {entry.paymentStatus === 'paid' ? (
                    <View style={[styles.paidBadge, { backgroundColor: 'rgba(34,197,94,0.15)' }]}>
                      <Ionicons name="checkmark-done" size={14} color={C.success} />
                      <Text style={[styles.paidBadgeText, { color: C.success }]}>Paid</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.payBtn}
                      onPress={() => handleMarkPaid(activePayroll.id, entry.employeeId)}>
                      <Text style={styles.payBtnText}>Mark Paid</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ═══ Salary Report ═══ */}
        {report && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Salary Report — {Salary.formatPayrollMonth(report.period)}</Text>
            <View style={styles.reportCard}>
              {[
                { label: 'Total Employees', value: String(report.totalEmployees) },
                { label: 'Total Gross', value: fmtPaise(report.totalGrossSalary) },
                { label: 'Total Deductions', value: fmtPaise(report.totalDeductions) },
                { label: 'Total Net Pay', value: fmtPaise(report.totalNetSalary), highlight: true },
                { label: 'Total Bonuses', value: fmtPaise(report.totalBonuses) },
                { label: 'Avg Salary', value: fmtPaise(report.averageSalary) },
                { label: 'Highest', value: fmtPaise(report.highestSalary) },
                { label: 'Lowest', value: fmtPaise(report.lowestSalary) },
              ].map((row, i, arr) => (
                <View key={i} style={[styles.reportRow, i === arr.length - 1 && styles.reportRowLast]}>
                  <Text style={styles.reportLabel}>{row.label}</Text>
                  <Text style={[styles.reportValue, row.highlight && { color: C.success }]}>{row.value}</Text>
                </View>
              ))}
              {report.momGrowth !== null && (
                <View style={[styles.reportRow, styles.reportRowLast]}>
                  <Text style={styles.reportLabel}>MoM Growth</Text>
                  <Text style={[styles.reportValue, { color: report.momGrowth >= 0 ? C.success : C.danger }]}>
                    {report.momGrowth >= 0 ? '+' : ''}{report.momGrowth}%
                  </Text>
                </View>
              )}

              {report.departmentBreakdown.length > 0 && (
                <View style={styles.deptSection}>
                  <Text style={styles.deptTitle}>Department Breakdown</Text>
                  {report.departmentBreakdown.map((dept) => (
                    <View key={dept.department} style={styles.deptRow}>
                      <Text style={styles.deptName}>{dept.department}</Text>
                      <Text style={styles.deptCount}>{dept.employeeCount} emp</Text>
                      <Text style={styles.deptTotal}>{fmtPaise(dept.totalSalary)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        )}

        <View style={{ height: 60 }} />
      </ScrollView>

      {/* ═══ Create Employee Modal ═══ */}
      <Modal visible={showCreateModal} animationType="slide" transparent onRequestClose={() => setShowCreateModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Employee</Text>
              <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                <Ionicons name="close" size={24} color={C.white} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              <Text style={styles.inputLabel}>Full Name *</Text>
              <TextInput style={styles.input} placeholder="John Doe" placeholderTextColor={C.textTertiary} value={empName} onChangeText={setEmpName} />

              <Text style={styles.inputLabel}>Email</Text>
              <TextInput style={styles.input} placeholder="john@company.com" placeholderTextColor={C.textTertiary} keyboardType="email-address" value={empEmail} onChangeText={setEmpEmail} autoCapitalize="none" />

              <Text style={styles.inputLabel}>Phone</Text>
              <TextInput style={styles.input} placeholder="+91 98765 43210" placeholderTextColor={C.textTertiary} keyboardType="phone-pad" value={empPhone} onChangeText={setEmpPhone} />

              <Text style={styles.inputLabel}>Role</Text>
              <TextInput style={styles.input} placeholder="Sales Executive" placeholderTextColor={C.textTertiary} value={empRole} onChangeText={setEmpRole} />

              <Text style={styles.inputLabel}>Department</Text>
              <View style={styles.optionRow}>
                {DEPARTMENTS.map((dept) => (
                  <TouchableOpacity
                    key={dept}
                    style={[styles.optionPill, empDepartment === dept && styles.optionPillActive]}
                    onPress={() => setEmpDepartment(dept)}>
                    <Text style={[styles.optionPillText, empDepartment === dept && styles.optionPillTextActive]}>{dept}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.inputLabel}>Monthly Base Salary (INR)</Text>
              <TextInput style={styles.input} placeholder="25000" placeholderTextColor={C.textTertiary} keyboardType="numeric" value={empSalary} onChangeText={setEmpSalary} />

              <TouchableOpacity style={[styles.submitBtn, creating && { opacity: 0.6 }]} onPress={handleCreateEmployee} disabled={creating}>
                <Text style={styles.submitBtnText}>{creating ? 'Adding...' : 'Add Employee'}</Text>
              </TouchableOpacity>
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ═══ Employee Detail Modal ═══ */}
      <Modal visible={!!selectedEmployee} animationType="slide" transparent onRequestClose={() => setSelectedEmployee(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '85%' }]}>
            {selectedEmployee && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Employee Details</Text>
                  <TouchableOpacity onPress={() => setSelectedEmployee(null)}>
                    <Ionicons name="close" size={24} color={C.white} />
                  </TouchableOpacity>
                </View>
                <ScrollView style={styles.modalBody}>
                  {/* Employee Header */}
                  <View style={styles.detailHeader}>
                    <View style={styles.detailAvatar}>
                      <Text style={styles.detailAvatarText}>{selectedEmployee.name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={styles.detailInfo}>
                      <Text style={styles.detailName}>{selectedEmployee.name}</Text>
                      <Text style={styles.detailRole}>{selectedEmployee.role} · {selectedEmployee.department}</Text>
                      {selectedEmployee.email ? <Text style={styles.detailMeta}>{selectedEmployee.email}</Text> : null}
                      {selectedEmployee.phone ? <Text style={styles.detailMeta}>{selectedEmployee.phone}</Text> : null}
                    </View>
                  </View>

                  {/* Status */}
                  <View style={styles.detailStatusRow}>
                    <View style={[styles.statusBadge, { backgroundColor: selectedEmployee.status === 'active' ? 'rgba(34,197,94,0.15)' : 'rgba(113,118,123,0.15)' }]}>
                      <Text style={[styles.statusText, { color: selectedEmployee.status === 'active' ? C.success : C.textSecondary }]}>
                        {selectedEmployee.status.charAt(0).toUpperCase() + selectedEmployee.status.slice(1)}
                      </Text>
                    </View>
                    <Text style={styles.joinDate}>
                      Joined {new Date(selectedEmployee.joinDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                    </Text>
                  </View>

                  {/* Salary Structure */}
                  <Text style={styles.sectionTitle}>Salary Structure</Text>
                  <View style={styles.structureCard}>
                    {[
                      { label: 'Basic Salary', value: selectedEmployee.salaryStructure.baseSalary, main: true },
                      { label: 'HRA', value: selectedEmployee.salaryStructure.hra },
                      { label: 'Dearness Allowance', value: selectedEmployee.salaryStructure.da },
                      { label: 'Special Allowance', value: selectedEmployee.salaryStructure.specialAllowance },
                      { label: 'Conveyance', value: selectedEmployee.salaryStructure.conveyance },
                      { label: 'Medical Allowance', value: selectedEmployee.salaryStructure.medicalAllowance },
                      { label: 'Commission', value: selectedEmployee.salaryStructure.commission },
                      { label: 'Bonus', value: selectedEmployee.salaryStructure.bonus },
                    ].map((item, i) => (
                      <View key={i} style={styles.structureRow}>
                        <Text style={styles.structureLabel}>{item.label}</Text>
                        <Text style={[styles.structureValue, item.main && styles.structureValueMain]}>{fmtPaise(item.value)}</Text>
                      </View>
                    ))}

                    <View style={[styles.structureDivider]} />
                    <Text style={styles.deductionsTitle}>Deductions</Text>
                    {[
                      { label: 'Provident Fund', value: selectedEmployee.salaryStructure.pf },
                      { label: 'Professional Tax', value: selectedEmployee.salaryStructure.professionalTax },
                      { label: 'TDS', value: selectedEmployee.salaryStructure.tds },
                      { label: 'Other Deductions', value: selectedEmployee.salaryStructure.otherDeductions },
                    ].map((item, i) => (
                      <View key={i} style={styles.structureRow}>
                        <Text style={styles.deductionLabel}>{item.label}</Text>
                        <Text style={styles.deductionValue}>- {fmtPaise(item.value)}</Text>
                      </View>
                    ))}

                    <View style={[styles.structureDivider]} />
                    <View style={styles.netRow}>
                      <Text style={styles.netLabel}>Net Pay</Text>
                      <Text style={styles.netValue}>{fmtPaise(Salary.computeNetSalary(selectedEmployee.salaryStructure))}</Text>
                    </View>
                  </View>

                  {/* Actions */}
                  {selectedEmployee.status === 'active' && (
                    <TouchableOpacity style={styles.removeBtn} onPress={() => handleRemoveEmployee(selectedEmployee.id)}>
                      <Ionicons name="person-remove-outline" size={18} color={C.danger} />
                      <Text style={styles.removeBtnText}>Remove Employee</Text>
                    </TouchableOpacity>
                  )}
                  <View style={{ height: 20 }} />
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

/* ── Styles ────────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  centerLoader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingHorizontal: S.lg, paddingVertical: S.md, borderBottomWidth: 1, borderBottomColor: C.surfaceBorder },
  headerTitle: { color: C.textPrimary, fontSize: F.xl, fontWeight: '700', flex: 1 },
  addEmpBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center' },

  // Sections
  section: { padding: S.lg },
  sectionTitle: { color: C.textPrimary, fontSize: F.lg, fontWeight: '600', marginBottom: S.md },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  // KPI Row
  kpiRow: { gap: S.sm },
  kpiCard: { backgroundColor: C.surface, borderRadius: BR.md, borderWidth: 1, borderColor: C.surfaceBorder, padding: S.md, alignItems: 'center', flexDirection: 'row', gap: S.sm },
  kpiValue: { color: C.white, fontSize: F.lg, fontWeight: '800' },
  kpiLabel: { color: C.textSecondary, fontSize: F.xs, marginTop: 2 },

  // Generate Payroll
  card: { backgroundColor: C.surface, borderRadius: BR.md, borderWidth: 1, borderColor: C.surfaceBorder, padding: S.md },
  generateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.sm, backgroundColor: C.gold, borderRadius: BR.md, paddingVertical: 14 },
  generateBtnText: { color: C.black, fontSize: F.md, fontWeight: '700' },
  generateHint: { color: C.textTertiary, fontSize: F.xs, marginTop: S.sm },

  // Employee Card
  empCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.surface, borderRadius: BR.md, borderWidth: 1, borderColor: C.surfaceBorder, padding: S.md, marginBottom: S.sm },
  empLeft: { flexDirection: 'row', alignItems: 'center', gap: S.md, flex: 1 },
  empAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,215,0,0.15)', alignItems: 'center', justifyContent: 'center' },
  empAvatarText: { color: C.gold, fontSize: F.md, fontWeight: '700' },
  empInfo: { flex: 1 },
  empName: { color: C.textPrimary, fontSize: F.sm, fontWeight: '600' },
  empRole: { color: C.textSecondary, fontSize: F.xs, marginTop: 2 },
  empRight: { alignItems: 'flex-end' },
  empSalary: { color: C.white, fontSize: F.md, fontWeight: '700' },
  empSalaryLabel: { color: C.textTertiary, fontSize: F.xs },

  // Empty
  emptyCard: { backgroundColor: C.surface, borderRadius: BR.md, borderWidth: 1, borderColor: C.surfaceBorder, padding: S.xxxl, alignItems: 'center' },
  emptyText: { color: C.textTertiary, fontSize: F.sm, textAlign: 'center', marginTop: S.md },

  // Payroll Card
  payrollCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.surface, borderRadius: BR.md, borderWidth: 1, borderColor: C.surfaceBorder, padding: S.md, marginBottom: S.sm },
  payrollCardActive: { borderColor: C.gold, borderWidth: 1.5 },
  payrollLeft: { flex: 1 },
  payrollMonth: { color: C.textPrimary, fontSize: F.md, fontWeight: '600' },
  payrollMeta: { color: C.textTertiary, fontSize: F.xs, marginTop: 2 },
  payrollRight: { alignItems: 'flex-end' },
  payrollTotal: { color: C.white, fontSize: F.md, fontWeight: '700' },
  payrollStatusBadge: { marginTop: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: BR.sm },
  payrollStatusText: { fontSize: F.xs, fontWeight: '700' },

  // Entry Card
  entryCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.surface, borderRadius: BR.md, borderWidth: 1, borderColor: C.surfaceBorder, padding: S.md, marginBottom: S.sm },
  entryLeft: { flexDirection: 'row', alignItems: 'center', gap: S.sm, flex: 1 },
  entryAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.surfaceBorder, alignItems: 'center', justifyContent: 'center' },
  entryAvatarText: { color: C.white, fontSize: F.sm, fontWeight: '600' },
  entryInfo: { flex: 1 },
  entryName: { color: C.textPrimary, fontSize: F.sm, fontWeight: '600' },
  entryRole: { color: C.textSecondary, fontSize: F.xs },
  entryBonus: { color: C.success, fontSize: F.xs, fontWeight: '500', marginTop: 2 },
  entryRight: { alignItems: 'flex-end' },
  entryNet: { color: C.white, fontSize: F.sm, fontWeight: '700' },
  paidBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: BR.sm, paddingHorizontal: 8, paddingVertical: 4, marginTop: 4 },
  paidBadgeText: { fontSize: F.xs, fontWeight: '700' },
  payBtn: { backgroundColor: C.gold, borderRadius: BR.sm, paddingHorizontal: 14, paddingVertical: 6, marginTop: 4 },
  payBtnText: { color: C.black, fontSize: F.xs, fontWeight: '700' },

  // Report
  reportBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(6,182,212,0.15)', borderRadius: BR.md, paddingHorizontal: 10, paddingVertical: 5 },
  reportBtnText: { color: C.info, fontSize: F.sm, fontWeight: '600' },
  reportCard: { backgroundColor: C.surface, borderRadius: BR.md, borderWidth: 1, borderColor: C.surfaceBorder, padding: S.md },
  reportRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: S.sm, borderBottomWidth: 0.5, borderBottomColor: C.surfaceBorder },
  reportRowLast: { borderBottomWidth: 0 },
  reportLabel: { color: C.textSecondary, fontSize: F.sm },
  reportValue: { color: C.textPrimary, fontSize: F.sm, fontWeight: '600' },
  deptSection: { marginTop: S.lg, paddingTop: S.lg, borderTopWidth: 1, borderTopColor: C.surfaceBorder },
  deptTitle: { color: C.textPrimary, fontSize: F.md, fontWeight: '600', marginBottom: S.sm },
  deptRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: S.xs, borderBottomWidth: 0.5, borderBottomColor: C.surfaceBorder },
  deptName: { flex: 1, color: C.textSecondary, fontSize: F.sm },
  deptCount: { color: C.textTertiary, fontSize: F.xs, marginRight: S.md },
  deptTotal: { color: C.textPrimary, fontSize: F.sm, fontWeight: '600' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: C.surface, borderTopLeftRadius: BR.xl, borderTopRightRadius: BR.xl, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: S.lg, borderBottomWidth: 1, borderBottomColor: C.surfaceBorder },
  modalTitle: { color: C.textPrimary, fontSize: F.lg, fontWeight: '600' },
  modalBody: { padding: S.lg },

  // Form
  inputLabel: { color: C.textSecondary, fontSize: F.sm, fontWeight: '500', marginBottom: S.xs, marginTop: S.md },
  input: { backgroundColor: C.bg, borderRadius: BR.sm, borderWidth: 1, borderColor: C.surfaceBorder, paddingHorizontal: S.md, paddingVertical: 10, color: C.textPrimary, fontSize: F.md },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginTop: S.sm },
  optionPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: BR.md, backgroundColor: C.bg, borderWidth: 1, borderColor: C.surfaceBorder },
  optionPillActive: { borderColor: C.gold, backgroundColor: 'rgba(255,215,0,0.15)' },
  optionPillText: { color: C.textTertiary, fontSize: F.sm, fontWeight: '500' },
  optionPillTextActive: { color: C.gold, fontWeight: '600' },
  submitBtn: { backgroundColor: C.gold, borderRadius: BR.md, paddingVertical: 14, alignItems: 'center', marginTop: S.xxl },
  submitBtnText: { color: C.black, fontSize: F.md, fontWeight: '700' },

  // Employee Detail
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: S.md, marginTop: S.lg },
  detailAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,215,0,0.15)', alignItems: 'center', justifyContent: 'center' },
  detailAvatarText: { color: C.gold, fontSize: F.xxl, fontWeight: '700' },
  detailInfo: { flex: 1 },
  detailName: { color: C.textPrimary, fontSize: F.lg, fontWeight: '700' },
  detailRole: { color: C.textSecondary, fontSize: F.sm, marginTop: 2 },
  detailMeta: { color: C.textTertiary, fontSize: F.xs, marginTop: 2 },
  detailStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: S.md },
  statusBadge: { borderRadius: BR.sm, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: F.sm, fontWeight: '700' },
  joinDate: { color: C.textTertiary, fontSize: F.xs },

  // Salary Structure
  structureCard: { backgroundColor: C.bg, borderRadius: BR.md, borderWidth: 1, borderColor: C.surfaceBorder, padding: S.md, marginTop: S.sm },
  structureRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: S.xs },
  structureLabel: { color: C.textSecondary, fontSize: F.sm },
  structureValue: { color: C.textPrimary, fontSize: F.sm, fontWeight: '600' },
  structureValueMain: { fontSize: F.md, fontWeight: '700', color: C.white },
  structureDivider: { height: 1, backgroundColor: C.surfaceBorder, marginVertical: S.sm },
  deductionsTitle: { color: C.danger, fontSize: F.sm, fontWeight: '600', marginBottom: S.xs },
  deductionLabel: { color: C.textSecondary, fontSize: F.sm },
  deductionValue: { color: C.danger, fontSize: F.sm, fontWeight: '600' },
  netRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: S.sm },
  netLabel: { color: C.white, fontSize: F.md, fontWeight: '700' },
  netValue: { color: C.success, fontSize: F.xl, fontWeight: '800' },

  // Remove
  removeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.sm, marginTop: S.xxl, paddingVertical: 14, borderRadius: BR.md, borderWidth: 1, borderColor: C.danger },
  removeBtnText: { color: C.danger, fontSize: F.sm, fontWeight: '600' },
});

export default SalaryScreen;
